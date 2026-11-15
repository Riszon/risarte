-- =============================================================================
-- 4015 — ASA4, entrega 1B: FORMA 2, "TODOS OS BOLETOS AGORA" (spec 19.9 acréscimo
-- A, 19.10, 19.25 e 19.26; aprovado pelo Jeferson em 15/11/2026)
-- -----------------------------------------------------------------------------
-- A ESCOLHA no fechamento (venda com boletos, unidade ligada): forma 1 "Um boleto
-- por mês" (padrão) ou forma 2 "Todos os boletos agora". Quem fechou a venda, o
-- Gerente da unidade, o Financeiro da Franqueadora e o Admin Master; na auditoria.
-- A FORMA 2: todos os boletos em aberto nascem de uma vez, no CADASTRO DO CARNÊ
-- do pagador no Asaas (um por pagador e por conta), com o "cobrança criada"
-- desligado para sempre (provado com envio real em 14/11/2026 — 19.16 e 19.26.5);
-- os outros avisos seguem a régua, com o mesmo contato do cadastro principal.
-- A LISTA: uma página do riSZon com os boletos (só o primeiro nome, vencimento,
-- valor, situação, "Abrir boleto" e linha digitável), endereço de 256 bits (só o
-- resumo gravado), revogável, que expira 5 dias depois do último vencimento;
-- cada acesso registrado; limite de tentativas.
-- BOLETO QUE DEIXA DE VALER (19.26.1): as operações que mudam a parcela cancelam
-- no Asaas na mesma operação (o servidor); aqui: o cancelamento "do sistema" (não
-- conta como à mão), a falha no meio vira pendência com aviso, o aviso de
-- "a lista mudou" e o alerta do pagamento de boleto cancelado.
-- Nenhum dado é apagado. Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) A FORMA NA VENDA
-- -----------------------------------------------------------------------------
alter table public.direct_sales add column if not exists boleto_mode text not null default 'mensal';
alter table public.direct_sales drop constraint if exists direct_sales_boleto_mode_check;
alter table public.direct_sales add constraint direct_sales_boleto_mode_check check (boleto_mode in ('mensal', 'todos'));
alter table public.plan_negotiations add column if not exists boleto_mode text not null default 'mensal';
alter table public.plan_negotiations drop constraint if exists plan_negotiations_boleto_mode_check;
alter table public.plan_negotiations add constraint plan_negotiations_boleto_mode_check check (boleto_mode in ('mensal', 'todos'));

create or replace function public._sale_boleto_mode(p_negotiation_id uuid, p_direct_sale_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select n.boleto_mode from public.plan_negotiations n where p_negotiation_id is not null and n.id = p_negotiation_id),
    (select s.boleto_mode from public.direct_sales s where p_direct_sale_id is not null and s.id = p_direct_sale_id),
    'mensal');
$$;
revoke execute on function public._sale_boleto_mode(uuid, uuid) from public, anon, authenticated;

-- Quem escolhe a forma e cuida da lista: quem fechou a venda, o Gerente da
-- unidade, o Financeiro da Franqueadora e o Admin Master.
create or replace function public._boleto_mode_can(p_negotiation_id uuid, p_direct_sale_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin_master() or public.is_finance_franchisor()
      or public._sale_closer(p_negotiation_id, p_direct_sale_id) = (select auth.uid())
      or public.has_role_in_clinic(
           coalesce((select n.clinic_id from public.plan_negotiations n where n.id = p_negotiation_id),
                    (select s.clinic_id from public.direct_sales s where s.id = p_direct_sale_id)),
           array['unit_manager']::public.user_role[]);
$$;
revoke execute on function public._boleto_mode_can(uuid, uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2) A COBRANÇA SABE SE SAIU PELO CARNÊ E SE FOI CANCELADA PELO SISTEMA
-- -----------------------------------------------------------------------------
alter table public.charges add column if not exists via_carne boolean not null default false;
alter table public.charges add column if not exists cancel_system boolean not null default false;

-- O cancelamento de uma operação (renegociação, cancelamento do plano,
-- parcelamento alterado, dinheiro, permuta, valor menor, troca de forma): não
-- conta como "cancelado à mão" (a parcela que continua existindo volta a ter
-- boleto pela rotina).
create or replace function public._charge_mark_cancelled_system(p_charge_id uuid, p_actor uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.charges c
     set status = 'cancelada', cancelled_at = now(), cancelled_by = p_actor, cancel_system = true,
         cancel_reason = left(coalesce(nullif(btrim(p_reason), ''), 'operação'), 300)
   where c.id = p_charge_id
     and c.status in ('emitindo', 'emitida', 'vencida', 'erro_emissao');
  if not found then raise exception 'CHARGE_NOT_CANCELLABLE'; end if;
end;
$$;
revoke execute on function public._charge_mark_cancelled_system(uuid, uuid, text) from public, anon, authenticated;

create or replace function public._auto_charge_cancelled_by_hand(p_installment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.charges c
     where c.payment_installment_id = p_installment_id and c.status = 'cancelada'
       -- 4015: o cancelamento de uma operação (cancel_system) não conta como à mão.
       and not c.cancel_system
       and not exists (select 1 from public.payment_receipts r
                        where r.installment_id = p_installment_id and r.reversal_of is null
                          and not coalesce(r.reversed, false) and r.created_at > coalesce(c.cancelled_at, c.updated_at)));
$$;
revoke execute on function public._auto_charge_cancelled_by_hand(uuid) from public, anon, authenticated;

create or replace function public._auto_charge_due(
  p_clinic_id uuid, p_negotiation_id uuid, p_direct_sale_id uuid, p_limit integer
)
returns table (installment_id uuid, clinic_id uuid, billing_type text, due_date date, origem text)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.clinic_id, public._auto_charge_billing(i.id), i.due_date, m.source
    from public.payment_installments i
    join public.sale_auto_charges m
      on (m.negotiation_id is not null and m.negotiation_id = i.negotiation_id)
      or (m.direct_sale_id is not null and m.direct_sale_id = i.direct_sale_id)
   where i.status in ('em_aberto', 'parcial')
     and i.renegotiation_id is null
     and coalesce(i.grace_days, 0) = 0
     and public._auto_charge_billing(i.id) is not null
     -- 4015: na forma 2, todos os boletos da venda (sem prazo).
     and (i.due_date <= public.today_br() + public._auto_charge_window()
          or (public._auto_charge_billing(i.id) = 'BOLETO'
              and public._sale_boleto_mode(i.negotiation_id, i.direct_sale_id) = 'todos'))
     and not public._installment_has_active_charge(i.id, false)
     and not public._auto_charge_cancelled_by_hand(i.id)
     and (p_clinic_id is null or i.clinic_id = p_clinic_id)
     and (p_negotiation_id is null or i.negotiation_id = p_negotiation_id)
     and (p_direct_sale_id is null or i.direct_sale_id = p_direct_sale_id)
     and public.central_is_ready(i.clinic_id)
   order by i.due_date, i.seq
   limit greatest(1, least(coalesce(p_limit, 200), 1000));
$$;
revoke execute on function public._auto_charge_due(uuid, uuid, uuid, integer) from public, anon, authenticated;

create or replace function public._charge_prepare_system(
  p_installment_id uuid, p_billing_type text, p_origin text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v record;
  v_id uuid;
begin
  select i.clinic_id into v_clinic from public.payment_installments i where i.id = p_installment_id for update;
  if v_clinic is null then raise exception 'INSTALLMENT_NOT_FOUND'; end if;
  if not exists (select 1 from public._auto_charge_due(v_clinic, null, null, 1000) d where d.installment_id = p_installment_id) then
    raise exception 'NOT_DUE';
  end if;
  select * into v from public._charge_compute(p_installment_id, p_billing_type, null);
  if v.error_code is not null then raise exception '%', v.error_code; end if;
  insert into public.charges (
    clinic_id, gateway_account_id, source_type, payment_installment_id, client_id,
    payer_kind, payer_guardian_id, billing_type, value_cents, discount_cents,
    fine_percent, fine_cents, interest_percent, due_date, is_overdue_reissue, status, created_by, auto_origin, via_carne
  ) values (
    v_clinic, v.gateway_account_id, 'installment', p_installment_id, v.client_id,
    v.payer_kind, v.payer_guardian_id, v.billing_type, v.value_cents, v.discount_cents,
    v.fine_percent, v.fine_cents, v.interest_percent, v.due_date, v.is_overdue_reissue, 'emitindo', null, p_origin,
    -- 4015: o boleto da forma 2 sai pelo cadastro do carnê.
    v.billing_type = 'BOLETO' and public._sale_boleto_mode(
      (select i.negotiation_id from public.payment_installments i where i.id = p_installment_id),
      (select i.direct_sale_id from public.payment_installments i where i.id = p_installment_id)) = 'todos'
  )
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public._charge_prepare_system(uuid, text, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3) O CADASTRO DO CARNÊ
-- -----------------------------------------------------------------------------
create table if not exists public.gateway_carne_customers (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.gateway_accounts (id),
  gateway_customer_id uuid not null references public.gateway_customers (id),
  asaas_customer_id text not null unique,
  created_at timestamptz not null default now(),
  unique (account_id, gateway_customer_id)
);
alter table public.gateway_carne_customers enable row level security;
drop policy if exists gateway_carne_customers_select on public.gateway_carne_customers;
create policy gateway_carne_customers_select on public.gateway_carne_customers for select to authenticated
  using (public.is_admin_master() or public.is_finance_franchisor());
comment on table public.gateway_carne_customers is
  'ASA4 (4015): o cadastro do carnê de cada pagador no Asaas (forma 2): o "cobrança criada" desligado para sempre; os demais avisos seguem a régua do cadastro principal.';

create or replace function public._gateway_carne_save(p_account_id uuid, p_gateway_customer_id uuid, p_asaas_customer_id text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.gateway_carne_customers (account_id, gateway_customer_id, asaas_customer_id)
  values (p_account_id, p_gateway_customer_id, p_asaas_customer_id)
  on conflict (account_id, gateway_customer_id) do update set asaas_customer_id = public.gateway_carne_customers.asaas_customer_id
  returning id into v_id;
  -- A régua do pagador entra na fila: a próxima rodada aplica no principal e no carnê.
  perform public._gateway_regua_enqueue(array[p_gateway_customer_id]);
  return v_id;
end;
$$;
revoke execute on function public._gateway_carne_save(uuid, uuid, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4) ESCOLHER A FORMA
-- -----------------------------------------------------------------------------
-- Devolve a forma e, na volta de 2 para 1, os boletos do carnê ainda não pagos que
-- vencem FORA do prazo (o servidor cancela no Asaas; os do prazo ficam — 1a).
create or replace function public.sale_boleto_mode_set(p_negotiation_id uuid, p_direct_sale_id uuid, p_mode text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_old text;
  v_user uuid := (select auth.uid());
  v_cancelar uuid[];
begin
  if (p_negotiation_id is null) = (p_direct_sale_id is null) then raise exception 'ORIGIN_REQUIRED'; end if;
  if p_mode not in ('mensal', 'todos') then raise exception 'INVALID_MODE'; end if;
  if not public._boleto_mode_can(p_negotiation_id, p_direct_sale_id) then raise exception 'NOT_ALLOWED'; end if;
  if p_negotiation_id is not null then
    select n.clinic_id, n.boleto_mode into v_clinic, v_old from public.plan_negotiations n where n.id = p_negotiation_id for update;
  else
    select s.clinic_id, s.boleto_mode into v_clinic, v_old from public.direct_sales s where s.id = p_direct_sale_id for update;
  end if;
  if v_clinic is null then raise exception 'SALE_NOT_FOUND'; end if;
  if p_mode = 'todos' then
    -- 4a: só com a unidade ligada nas Cobranças automáticas, e só se houver boleto.
    if not public._auto_charge_unit_on(v_clinic) then raise exception 'UNIT_NOT_ON'; end if;
    if not exists (select 1 from public.payment_installments i
                    where i.payment_method = 'boleto' and i.status in ('em_aberto', 'parcial')
                      and ((p_negotiation_id is not null and i.negotiation_id = p_negotiation_id)
                        or (p_direct_sale_id is not null and i.direct_sale_id = p_direct_sale_id))) then
      raise exception 'NO_BOLETO';
    end if;
  end if;
  if p_negotiation_id is not null then
    update public.plan_negotiations set boleto_mode = p_mode where id = p_negotiation_id;
  else
    update public.direct_sales set boleto_mode = p_mode where id = p_direct_sale_id;
  end if;
  if v_old = 'todos' and p_mode = 'mensal' then
    select coalesce(array_agg(c.id), '{}') into v_cancelar
      from public.charges c join public.payment_installments i on i.id = c.payment_installment_id
     where c.via_carne and c.status in ('emitida', 'vencida')
       and c.due_date > public.today_br() + public._auto_charge_window()
       and ((p_negotiation_id is not null and i.negotiation_id = p_negotiation_id)
         or (p_direct_sale_id is not null and i.direct_sale_id = p_direct_sale_id));
  end if;
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_clinic, 'update', 'sale_boleto_mode', coalesce(p_negotiation_id, p_direct_sale_id)::text,
          jsonb_build_object('de', v_old, 'para', p_mode, 'a_cancelar', coalesce(cardinality(v_cancelar), 0)));
  return jsonb_build_object('mode', p_mode, 'old', v_old, 'a_cancelar', coalesce(to_jsonb(v_cancelar), '[]'::jsonb), 'clinic', v_clinic);
end;
$$;
revoke execute on function public.sale_boleto_mode_set(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.sale_boleto_mode_set(uuid, uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 5) A PÁGINA DA LISTA
-- -----------------------------------------------------------------------------
create table if not exists public.boleto_lists (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  negotiation_id uuid references public.plan_negotiations (id),
  direct_sale_id uuid references public.direct_sales (id),
  client_id uuid references public.clients (id),
  token_hash text not null unique,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  expires_at date not null,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id),
  constraint boleto_lists_origin_check check ((negotiation_id is null) <> (direct_sale_id is null))
);
create index if not exists boleto_lists_sale_idx on public.boleto_lists (negotiation_id, direct_sale_id) where revoked_at is null;
alter table public.boleto_lists enable row level security;
drop policy if exists boleto_lists_select on public.boleto_lists;
create policy boleto_lists_select on public.boleto_lists for select to authenticated
  using (public._boleto_mode_can(negotiation_id, direct_sale_id));

create table if not exists public.boleto_list_accesses (
  id bigint generated always as identity primary key,
  list_id uuid not null references public.boleto_lists (id),
  accessed_at timestamptz not null default now(),
  ip_hash text,
  user_agent text
);
create index if not exists boleto_list_accesses_list_idx on public.boleto_list_accesses (list_id, accessed_at desc);
alter table public.boleto_list_accesses enable row level security;
drop policy if exists boleto_list_accesses_select on public.boleto_list_accesses;
create policy boleto_list_accesses_select on public.boleto_list_accesses for select to authenticated
  using (exists (select 1 from public.boleto_lists l where l.id = list_id and public._boleto_mode_can(l.negotiation_id, l.direct_sale_id)));

-- As tentativas com endereço errado, por IP (resumo), para o limite.
create table if not exists public.boleto_list_misses (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  missed_at timestamptz not null default now()
);
create index if not exists boleto_list_misses_ip_idx on public.boleto_list_misses (ip_hash, missed_at desc);
alter table public.boleto_list_misses enable row level security;

-- Emitir o link (o servidor gera o código; o banco recebe só o resumo). O link
-- anterior da venda para na hora.
create or replace function public.boleto_list_issue(p_negotiation_id uuid, p_direct_sale_id uuid, p_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_client uuid;
  v_ultimo date;
  v_id uuid;
  v_user uuid := (select auth.uid());
begin
  if (p_negotiation_id is null) = (p_direct_sale_id is null) then raise exception 'ORIGIN_REQUIRED'; end if;
  if not public._boleto_mode_can(p_negotiation_id, p_direct_sale_id) then raise exception 'NOT_ALLOWED'; end if;
  if public._sale_boleto_mode(p_negotiation_id, p_direct_sale_id) <> 'todos' then raise exception 'NOT_FORMA_2'; end if;
  if length(coalesce(p_token_hash, '')) <> 64 then raise exception 'INVALID_TOKEN'; end if;
  select min(i.clinic_id::text)::uuid, min(i.client_id::text)::uuid, max(i.due_date) into v_clinic, v_client, v_ultimo
    from public.payment_installments i
   where i.payment_method = 'boleto' and i.status <> 'cancelada'
     and ((p_negotiation_id is not null and i.negotiation_id = p_negotiation_id)
       or (p_direct_sale_id is not null and i.direct_sale_id = p_direct_sale_id));
  if v_clinic is null then raise exception 'NO_BOLETO'; end if;
  update public.boleto_lists set revoked_at = now(), revoked_by = v_user
   where revoked_at is null
     and ((p_negotiation_id is not null and negotiation_id = p_negotiation_id)
       or (p_direct_sale_id is not null and direct_sale_id = p_direct_sale_id));
  insert into public.boleto_lists (clinic_id, negotiation_id, direct_sale_id, client_id, token_hash, created_by, expires_at)
  values (v_clinic, p_negotiation_id, p_direct_sale_id, v_client, p_token_hash, v_user, v_ultimo + 5)
  returning id into v_id;
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_clinic, 'create', 'boleto_list', v_id::text, jsonb_build_object('expira', v_ultimo + 5));
  return v_id;
end;
$$;
revoke execute on function public.boleto_list_issue(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.boleto_list_issue(uuid, uuid, text) to authenticated;

create or replace function public.boleto_list_revoke(p_negotiation_id uuid, p_direct_sale_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if not public._boleto_mode_can(p_negotiation_id, p_direct_sale_id) then raise exception 'NOT_ALLOWED'; end if;
  update public.boleto_lists set revoked_at = now(), revoked_by = (select auth.uid())
   where revoked_at is null
     and ((p_negotiation_id is not null and negotiation_id = p_negotiation_id)
       or (p_direct_sale_id is not null and direct_sale_id = p_direct_sale_id));
  get diagnostics v_n = row_count;
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  select (select auth.uid()), l.clinic_id, 'update', 'boleto_list', l.id::text, jsonb_build_object('revogada', true)
    from public.boleto_lists l
   where ((p_negotiation_id is not null and l.negotiation_id = p_negotiation_id)
       or (p_direct_sale_id is not null and l.direct_sale_id = p_direct_sale_id))
   order by l.created_at desc limit 1;
  return v_n;
end;
$$;
revoke execute on function public.boleto_list_revoke(uuid, uuid) from public, anon, authenticated;
grant execute on function public.boleto_list_revoke(uuid, uuid) to authenticated;

-- O envio da lista conta como envio de CADA boleto dela (os alertas de 1 e 2 dias úteis).
alter table public.charge_link_sends drop constraint if exists charge_link_sends_channel_check;
alter table public.charge_link_sends add constraint charge_link_sends_channel_check
  check (channel in ('copiar_link', 'whatsapp', 'copiar_pix', 'linha_digitavel', 'lista_copiada', 'lista_whatsapp'));

create or replace function public.boleto_list_sent(p_negotiation_id uuid, p_direct_sale_id uuid, p_channel text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if p_channel not in ('lista_copiada', 'lista_whatsapp') then raise exception 'INVALID_CHANNEL'; end if;
  if not public._boleto_mode_can(p_negotiation_id, p_direct_sale_id) then raise exception 'NOT_ALLOWED'; end if;
  insert into public.charge_link_sends (charge_id, channel, sent_by)
  select c.id, p_channel, (select auth.uid())
    from public.charges c join public.payment_installments i on i.id = c.payment_installment_id
   where c.billing_type = 'BOLETO' and c.status in ('emitida', 'vencida')
     and ((p_negotiation_id is not null and i.negotiation_id = p_negotiation_id)
       or (p_direct_sale_id is not null and i.direct_sale_id = p_direct_sale_id));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function public.boleto_list_sent(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.boleto_list_sent(uuid, uuid, text) to authenticated;

-- A LEITURA PÚBLICA (só o servidor, sem login): confere o limite, o resumo do
-- código, a revogação e a validade; registra o acesso; marca "aberta" nos boletos
-- (o alerta de "não abriu" conta o acesso à lista — 19.26.4); devolve o mínimo.
create or replace function public._boleto_list_read(p_token_hash text, p_ip_hash text, p_user_agent text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.boleto_lists%rowtype;
  v_nome text;
  v_boletos jsonb;
begin
  if (select count(*) from public.boleto_list_misses m
       where m.ip_hash = coalesce(p_ip_hash, '-') and m.missed_at > now() - interval '1 hour') >= 20 then
    return jsonb_build_object('erro', 'limite');
  end if;
  select * into l from public.boleto_lists where token_hash = p_token_hash;
  if not found then
    insert into public.boleto_list_misses (ip_hash) values (coalesce(p_ip_hash, '-'));
    return jsonb_build_object('erro', 'invalido');
  end if;
  if l.revoked_at is not null or l.expires_at < public.today_br() then
    return jsonb_build_object('erro', 'expirado');
  end if;
  if (select count(*) from public.boleto_list_accesses a where a.list_id = l.id and a.accessed_at > now() - interval '1 hour') >= 60 then
    return jsonb_build_object('erro', 'limite');
  end if;
  insert into public.boleto_list_accesses (list_id, ip_hash, user_agent) values (l.id, p_ip_hash, left(p_user_agent, 120));
  select split_part(btrim(c.full_name), ' ', 1) into v_nome from public.clients c where c.id = l.client_id;
  -- A cobrança mais recente de cada parcela em boleto da venda.
  select coalesce(jsonb_agg(jsonb_build_object(
           'vencimento', x.due_date, 'valor', x.value_cents, 'situacao', x.situacao,
           'link', case when x.situacao in ('a_pagar', 'vencido') then x.invoice_url end,
           'linha', case when x.situacao in ('a_pagar', 'vencido') then x.identification_field end)
         order by x.due_date, x.seq), '[]'::jsonb)
    into v_boletos
    from (
      select i.seq, i.due_date, coalesce(ch.value_cents, i.amount_cents) value_cents, ch.invoice_url, ch.identification_field,
             case
               when i.status = 'paga' or ch.status in ('paga', 'liquidada') then
                 case when exists (select 1 from public.payment_receipts r where r.installment_id = i.id and r.reversal_of is null
                                    and not coalesce(r.reversed, false) and r.payment_method = 'dinheiro') then 'pago_no_balcao'
                      when exists (select 1 from public.payment_receipts r where r.installment_id = i.id and r.reversal_of is null
                                    and not coalesce(r.reversed, false) and r.payment_method = 'permuta') then 'pago_permuta'
                      when exists (select 1 from public.payment_waivers w where w.installment_id = i.id) then 'quitado_valor_menor'
                      else 'pago' end
               when i.status = 'renegociada' then 'substituido_renegociacao'
               when i.status = 'cancelada' then 'cancelado'
               when ch.status in ('emitida') then 'a_pagar'
               when ch.status in ('vencida') then 'vencido'
               else 'sem_boleto' end as situacao
        from public.payment_installments i
        left join lateral (
          select c.* from public.charges c where c.payment_installment_id = i.id and c.billing_type = 'BOLETO'
           order by c.created_at desc limit 1) ch on true
       where i.payment_method = 'boleto'
         and ((l.negotiation_id is not null and i.negotiation_id = l.negotiation_id)
           or (l.direct_sale_id is not null and i.direct_sale_id = l.direct_sale_id))
         and (ch.id is not null or i.status in ('renegociada', 'cancelada', 'paga'))
    ) x;
  update public.charges c set viewed_at = coalesce(c.viewed_at, now())
    from public.payment_installments i
   where i.id = c.payment_installment_id and c.billing_type = 'BOLETO' and c.status in ('emitida', 'vencida')
     and ((l.negotiation_id is not null and i.negotiation_id = l.negotiation_id)
       or (l.direct_sale_id is not null and i.direct_sale_id = l.direct_sale_id));
  return jsonb_build_object('nome', v_nome, 'expira', l.expires_at, 'boletos', v_boletos);
end;
$$;
revoke execute on function public._boleto_list_read(text, text, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6) "A LISTA MUDOU": aviso a quem fechou a venda e ao Gerente (um por lista por dia)
-- -----------------------------------------------------------------------------
create or replace function public.charges_boleto_list_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inst public.payment_installments%rowtype;
  l public.boleto_lists%rowtype;
  v_users uuid[];
begin
  if new.billing_type <> 'BOLETO' then return new; end if;
  if tg_op = 'UPDATE' and not (new.status = 'cancelada' and old.status is distinct from 'cancelada') then return new; end if;
  if tg_op = 'INSERT' and not new.via_carne then return new; end if;
  select * into v_inst from public.payment_installments where id = new.payment_installment_id;
  select * into l from public.boleto_lists bl
   where bl.revoked_at is null and bl.expires_at >= public.today_br()
     and ((v_inst.negotiation_id is not null and bl.negotiation_id = v_inst.negotiation_id)
       or (v_inst.direct_sale_id is not null and bl.direct_sale_id = v_inst.direct_sale_id))
   order by bl.created_at desc limit 1;
  if l.id is null then return new; end if;
  select coalesce(array_agg(u.user_id), '{}') into v_users from public.user_clinic_roles u
   where u.clinic_id = l.clinic_id and u.role = 'unit_manager';
  v_users := v_users || array[public._sale_closer(v_inst.negotiation_id, v_inst.direct_sale_id)];
  perform public._notify_users('lista_de_boletos_mudou', l.id::text || ':' || public.today_br()::text, v_users, l.clinic_id,
    'A lista de boletos mudou: reenvie o link',
    'Um boleto da lista enviada ao paciente foi cancelado, substituído ou criado. A página já mostra a situação nova; reenvie o link para o paciente saber.',
    '/prontuarios/' || v_inst.client_id::text);
  return new;
end;
$$;
revoke execute on function public.charges_boleto_list_changed() from public, anon, authenticated;
drop trigger if exists charges_boleto_list_changed on public.charges;
create trigger charges_boleto_list_changed
  after insert or update of status on public.charges
  for each row execute function public.charges_boleto_list_changed();

-- -----------------------------------------------------------------------------
-- 7) A FALHA NO MEIO DA OPERAÇÃO (o boleto foi cancelado e a mudança não entrou)
-- -----------------------------------------------------------------------------
create table if not exists public.boleto_op_failures (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  client_id uuid references public.clients (id),
  negotiation_id uuid,
  direct_sale_id uuid,
  operation text not null,
  installment_ids uuid[] not null default '{}',
  cancelled_charge_ids uuid[] not null default '{}',
  error text,
  actor_id uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id),
  resolution text
);
create index if not exists boleto_op_failures_open_idx on public.boleto_op_failures (clinic_id) where resolved_at is null;
alter table public.boleto_op_failures enable row level security;
drop policy if exists boleto_op_failures_select on public.boleto_op_failures;
create policy boleto_op_failures_select on public.boleto_op_failures for select to authenticated
  using (public.is_admin_master() or public.is_finance_franchisor()
         or public.has_role_in_clinic(clinic_id, array['unit_manager']::public.user_role[]) or actor_id = (select auth.uid()));

create or replace function public._boleto_op_failure_record(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_clinic uuid := (p ->> 'clinic_id')::uuid;
  v_client uuid := nullif(p ->> 'client_id', '')::uuid;
  v_actor uuid := nullif(p ->> 'actor_id', '')::uuid;
  v_users uuid[];
begin
  insert into public.boleto_op_failures (clinic_id, client_id, negotiation_id, direct_sale_id, operation,
                                         installment_ids, cancelled_charge_ids, error, actor_id)
  values (v_clinic, v_client, nullif(p ->> 'negotiation_id', '')::uuid, nullif(p ->> 'direct_sale_id', '')::uuid,
          coalesce(p ->> 'operation', 'operação'),
          coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p -> 'installment_ids') x), '{}'),
          coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p -> 'cancelled_charge_ids') x), '{}'),
          left(p ->> 'error', 500), v_actor)
  returning id into v_id;
  select coalesce(array_agg(u.user_id), '{}') into v_users from public.user_clinic_roles u
   where u.clinic_id = v_clinic and u.role = 'unit_manager';
  perform public._notify_users('operacao_interrompida', v_id::text, v_users || array[v_actor], v_clinic,
    'Operação interrompida: boleto cancelado sem a mudança',
    'Os boletos foram cancelados no Asaas, mas a ' || coalesce(p ->> 'operation', 'operação') ||
    ' não entrou no riSZon. A parcela está sem boleto: conclua a operação ou reemita o boleto (Financeiro › Cobranças automáticas).',
    case when v_client is null then null else '/prontuarios/' || v_client::text end);
  return v_id;
end;
$$;
revoke execute on function public._boleto_op_failure_record(jsonb) from public, anon, authenticated;

create or replace function public.boleto_op_failure_resolve(p_id uuid, p_resolution text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.boleto_op_failures%rowtype;
begin
  select * into f from public.boleto_op_failures where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not (public.is_admin_master() or public.is_finance_franchisor()
          or public.has_role_in_clinic(f.clinic_id, array['unit_manager']::public.user_role[]) or f.actor_id = (select auth.uid())) then
    raise exception 'NOT_ALLOWED';
  end if;
  if f.resolved_at is not null then return; end if;
  update public.boleto_op_failures set resolved_at = now(), resolved_by = (select auth.uid()),
         resolution = left(coalesce(nullif(btrim(p_resolution), ''), 'concluída'), 300)
   where id = p_id;
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), f.clinic_id, 'update', 'boleto_op_failure', p_id::text, jsonb_build_object('resolution', p_resolution));
end;
$$;
revoke execute on function public.boleto_op_failure_resolve(uuid, text) from public, anon, authenticated;
grant execute on function public.boleto_op_failure_resolve(uuid, text) to authenticated;

create or replace function public.boleto_op_failures_read(p_clinic_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', f.id, 'clinic_id', f.clinic_id, 'client_id', f.client_id, 'cliente', c.full_name,
           'negotiation_id', f.negotiation_id, 'direct_sale_id', f.direct_sale_id,
           'operacao', f.operation, 'parcelas', cardinality(f.installment_ids), 'boletos_cancelados', cardinality(f.cancelled_charge_ids),
           'erro', f.error, 'quando', f.created_at, 'quem', (select full_name from public.profiles where id = f.actor_id))
         order by f.created_at desc), '[]'::jsonb)
    from public.boleto_op_failures f left join public.clients c on c.id = f.client_id
   where f.resolved_at is null and (p_clinic_id is null or f.clinic_id = p_clinic_id)
     and (public.is_admin_master() or public.is_finance_franchisor()
          or public.has_role_in_clinic(f.clinic_id, array['unit_manager']::public.user_role[]) or f.actor_id = (select auth.uid()));
$$;
revoke execute on function public.boleto_op_failures_read(uuid) from public, anon, authenticated;
grant execute on function public.boleto_op_failures_read(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 8) O PAGAMENTO DE UM BOLETO QUE O riSZon CANCELOU (19.26, ponto 2)
-- -----------------------------------------------------------------------------
-- O aviso do Asaas cai em `_gateway_on_paid`, que já guarda o valor como
-- "duplicidade" (`gateway_payment_surpluses`, motivo `cobranca_cancelada`) sem dar
-- baixa. Aqui, o ALERTA com o valor, a parcela e o que fazer, para o Gerente da
-- unidade e o Financeiro da Franqueadora.
create or replace function public.gateway_surplus_cancelled_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.payment_installments%rowtype;
  v_users uuid[];
begin
  if new.reason <> 'cobranca_cancelada' then return new; end if;
  select * into i from public.payment_installments where id = new.installment_id;
  select coalesce(array_agg(u.user_id), '{}') into v_users from public.user_clinic_roles u
   where u.clinic_id = new.clinic_id and u.role = 'unit_manager';
  perform public._notify_users('boleto_cancelado_pago', new.id::text, v_users || public._admins_and_finance(), new.clinic_id,
    'Pagaram um boleto que o riSZon tinha cancelado',
    'Entrou ' || public.brl(new.amount_cents) || ' pelo Asaas num boleto cancelado: parcela ' || coalesce(i.seq::text, '?') ||
    coalesce(', vencimento ' || to_char(i.due_date, 'DD/MM/YYYY'), '') ||
    '. O dinheiro está na conta da unidade e NÃO deu baixa. Na ficha do paciente (Financeiro › pagamento em duplicidade), abata numa parcela em aberto ou registre a devolução.',
    '/prontuarios/' || new.client_id::text);
  return new;
end;
$$;
revoke execute on function public.gateway_surplus_cancelled_alert() from public, anon, authenticated;
drop trigger if exists gateway_surplus_cancelled_alert on public.gateway_payment_surpluses;
create trigger gateway_surplus_cancelled_alert
  after insert on public.gateway_payment_surpluses
  for each row execute function public.gateway_surplus_cancelled_alert();

-- -----------------------------------------------------------------------------
-- 9) AS COBRANÇAS DA VENDA mostram a forma e a lista
-- -----------------------------------------------------------------------------
create or replace function public._sale_boleto_summary(p_negotiation_id uuid, p_direct_sale_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'forma', public._sale_boleto_mode(p_negotiation_id, p_direct_sale_id),
    'tem_boleto', exists (select 1 from public.payment_installments i where i.payment_method = 'boleto' and i.status <> 'cancelada'
                           and ((p_negotiation_id is not null and i.negotiation_id = p_negotiation_id)
                             or (p_direct_sale_id is not null and i.direct_sale_id = p_direct_sale_id))),
    'pode_escolher', public._boleto_mode_can(p_negotiation_id, p_direct_sale_id),
    'unidade_ligada', public._auto_charge_unit_on(coalesce(
        (select n.clinic_id from public.plan_negotiations n where n.id = p_negotiation_id),
        (select s.clinic_id from public.direct_sales s where s.id = p_direct_sale_id))),
    'prazo', public._auto_charge_window(),
    'boletos_no_carne', (select count(*) from public.charges c join public.payment_installments i on i.id = c.payment_installment_id
                          where c.via_carne and c.status in ('emitida', 'vencida', 'paga', 'liquidada')
                            and ((p_negotiation_id is not null and i.negotiation_id = p_negotiation_id)
                              or (p_direct_sale_id is not null and i.direct_sale_id = p_direct_sale_id))),
    'boletos_para_depois', (select count(*) from public.payment_installments i
                          where i.payment_method = 'boleto' and i.status in ('em_aberto', 'parcial')
                            and not public._installment_has_active_charge(i.id, false)
                            and public._sale_boleto_mode(p_negotiation_id, p_direct_sale_id) = 'todos'
                            and ((p_negotiation_id is not null and i.negotiation_id = p_negotiation_id)
                              or (p_direct_sale_id is not null and i.direct_sale_id = p_direct_sale_id))),
    'lista', (select jsonb_build_object('id', l.id, 'criada_em', l.created_at, 'expira', l.expires_at,
                     'acessos', (select count(*) from public.boleto_list_accesses a where a.list_id = l.id),
                     'ultimo_acesso', (select max(a.accessed_at) from public.boleto_list_accesses a where a.list_id = l.id))
                from public.boleto_lists l
               where l.revoked_at is null and l.expires_at >= public.today_br()
                 and ((p_negotiation_id is not null and l.negotiation_id = p_negotiation_id)
                   or (p_direct_sale_id is not null and l.direct_sale_id = p_direct_sale_id))
               order by l.created_at desc limit 1),
    'operacoes_interrompidas', (select count(*) from public.boleto_op_failures f
                                 where f.resolved_at is null
                                   and ((p_negotiation_id is not null and f.negotiation_id = p_negotiation_id)
                                     or (p_direct_sale_id is not null and f.direct_sale_id = p_direct_sale_id))));
$$;
revoke execute on function public._sale_boleto_summary(uuid, uuid) from public, anon, authenticated;

create or replace function public.sale_charges_read(p_negotiation_id uuid, p_direct_sale_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_window integer := public._auto_charge_window();
  v_closed timestamptz;
begin
  if (p_negotiation_id is null) = (p_direct_sale_id is null) then raise exception 'ORIGIN_REQUIRED'; end if;
  if not public._sale_charges_can(p_negotiation_id, p_direct_sale_id) then raise exception 'NOT_ALLOWED'; end if;
  if p_negotiation_id is not null then
    select cs.closed_at into v_closed from public.commercial_sales cs where cs.negotiation_id = p_negotiation_id;
  else
    select s.closed_at into v_closed from public.direct_sales s where s.id = p_direct_sale_id;
  end if;
  return jsonb_build_object(
    'automatica', exists (select 1 from public.sale_auto_charges m
                           where (p_negotiation_id is not null and m.negotiation_id = p_negotiation_id)
                              or (p_direct_sale_id is not null and m.direct_sale_id = p_direct_sale_id)),
    'prazo', v_window,
    'venda_fechada_em', v_closed,
    -- 4013: o cartão parcelado pelo Asaas da venda (um bloco), se houver.
    'parcelamento', public._card_block_summary(p_negotiation_id, p_direct_sale_id),
    -- 4015: a forma dos boletos e a lista.
    'boletos', public._sale_boleto_summary(p_negotiation_id, p_direct_sale_id),
    'parcelas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'installment_id', i.id, 'seq', i.seq, 'tipo', i.kind, 'vencimento', i.due_date,
               'valor', i.amount_cents, 'pago', coalesce(i.paid_amount_cents, 0), 'meio', i.payment_method,
               'situacao_parcela', i.status,
               'parcelado', i.payment_method = 'cartao_parcelado_asaas',
               'pelo_asaas', public._auto_charge_billing(i.id) is not null,
               'agendada_para', case when ch.id is null and i.status in ('em_aberto', 'parcial')
                                       and public._auto_charge_billing(i.id) is not null
                                     then greatest(public.today_br(), i.due_date - v_window) end,
               'cobranca', case when ch.id is null then null else jsonb_build_object(
                  'id', ch.id, 'status', ch.status, 'meio', ch.billing_type, 'valor', ch.value_cents,
                  'link', ch.invoice_url, 'boleto', ch.bank_slip_url, 'pix', ch.pix_copy_paste,
                  'linha', ch.identification_field, 'criada_em', ch.issued_at, 'origem', ch.auto_origin,
                  'enviada_pelo_asaas_em', ch.asaas_sent_at, 'aberta_em', ch.viewed_at, 'paga_em', ch.paid_on,
                  'via_carne', ch.via_carne) end,
               'ultimo_envio', (select jsonb_build_object('canal', l.channel, 'quem', pr.full_name, 'quando', l.sent_at)
                                  from public.charge_link_sends l left join public.profiles pr on pr.id = l.sent_by
                                 where l.charge_id = ch.id order by l.sent_at desc limit 1))
             order by i.seq)
        from public.payment_installments i
        left join lateral (
          select c.* from public.charges c
           where c.payment_installment_id = i.id and c.status <> 'cancelada'
           order by c.created_at desc limit 1) ch on true
       where (p_negotiation_id is not null and i.negotiation_id = p_negotiation_id)
          or (p_direct_sale_id is not null and i.direct_sale_id = p_direct_sale_id)), '[]')
  );
end;
$$;
revoke execute on function public.sale_charges_read(uuid, uuid) from public, anon, authenticated;
grant execute on function public.sale_charges_read(uuid, uuid) to authenticated;

-- O Asaas avisar que restaurou uma cobrança que o riSZon cancelou (a documentação
-- não diz o que acontece quando pagam um boleto removido — pergunta ao Asaas,
-- 19.27): alerta o Gerente e o Financeiro na hora, antes de qualquer baixa.
create or replace function public.gateway_events_restored_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.charges%rowtype;
  i public.payment_installments%rowtype;
  v_users uuid[];
begin
  if new.event <> 'PAYMENT_RESTORED' then return new; end if;
  select * into c from public.charges ch
   where ch.asaas_payment_id = new.payload -> 'payment' ->> 'id' and ch.gateway_account_id = new.account_id;
  if c.id is null or c.status <> 'cancelada' then return new; end if;
  select * into i from public.payment_installments where id = c.payment_installment_id;
  select coalesce(array_agg(u.user_id), '{}') into v_users from public.user_clinic_roles u
   where u.clinic_id = c.clinic_id and u.role = 'unit_manager';
  perform public._notify_users('cobranca_cancelada_restaurada', c.id::text, v_users || public._admins_and_finance(), c.clinic_id,
    'O Asaas restaurou um boleto que o riSZon tinha cancelado',
    'O boleto de ' || public.brl(c.value_cents) || ' da parcela ' || coalesce(i.seq::text, '?') ||
    coalesce(' (vencimento ' || to_char(i.due_date, 'DD/MM/YYYY') || ')', '') ||
    ' voltou a existir no Asaas. Se o paciente pagou, o valor chega como pagamento em duplicidade na ficha (sem baixa): abata numa parcela em aberto ou registre a devolução.',
    '/prontuarios/' || c.client_id::text);
  return new;
end;
$$;
revoke execute on function public.gateway_events_restored_alert() from public, anon, authenticated;
drop trigger if exists gateway_events_restored_alert on public.gateway_webhook_events;
create trigger gateway_events_restored_alert
  after insert on public.gateway_webhook_events
  for each row execute function public.gateway_events_restored_alert();

-- -----------------------------------------------------------------------------
-- 10) AUDITORIA E CONFERÊNCIA
-- -----------------------------------------------------------------------------
select public.audit_attach_all();

select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      '_sale_boleto_mode', '_boleto_mode_can', '_charge_mark_cancelled_system', '_gateway_carne_save',
      'sale_boleto_mode_set', 'boleto_list_issue', 'boleto_list_revoke', 'boleto_list_sent', '_boleto_list_read',
      '_boleto_op_failure_record', 'boleto_op_failure_resolve', 'boleto_op_failures_read', '_sale_boleto_summary')) as funcoes_novas,
  (select count(*) from information_schema.tables where table_schema = 'public'
    and table_name in ('gateway_carne_customers', 'boleto_lists', 'boleto_list_accesses', 'boleto_list_misses', 'boleto_op_failures')) as tabelas_novas,
  (select count(*) from public.direct_sales where boleto_mode = 'todos') + (select count(*) from public.plan_negotiations where boleto_mode = 'todos') as vendas_na_forma_2,
  (select count(*) from public.charges where via_carne) as boletos_no_carne;
