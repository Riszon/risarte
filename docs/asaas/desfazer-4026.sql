-- DESFAZER a 4026 (só se precisar). Roda inteiro, de uma vez, no SQL Editor.
-- O riSZon volta a não reconhecer o pagamento no débito (o débito precisa
-- continuar DESABILITADO no painel do Asaas de todas as unidades). As tabelas
-- e colunas novas ficam (sem efeito), com o que tiverem; nada é apagado.
-- A permissão das leituras do Painel de repasses (que a 4026 devolveu) fica:
-- é a correção de um defeito da 4021, não parte do débito.

drop trigger if exists charges_debit_paid on public.charges;
drop trigger if exists charge_splits_debit_excess on public.charge_splits;
drop function if exists public._gateway_debit_on_paid();
drop function if exists public._gateway_debit_excess_sync();
drop function if exists public._gateway_debit_fix_queue(uuid, integer);
drop function if exists public._gateway_debit_fix_done(uuid, text, jsonb, jsonb, text);
drop function if exists public._gateway_debit_fix_plan(uuid);
drop function if exists public._gateway_debit_detect(uuid, jsonb);
drop function if exists public.split_debit_cases_read(date, date, uuid);
drop function if exists public.gateway_declare_debit(uuid, boolean);

do $do$
declare d text := pg_get_functiondef('public._gateway_apply_event(bigint)'::regprocedure); orig text;
begin
  orig := d;
  if position($n1$  update public.gateway_webhook_events set charge_id = c.id where id = e.id; -- 4026: o meio que o pagador USOU (pelo aviso e pelo valor líquido)
  if e.event in ('PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_DUNNING_RECEIVED') then
    perform public._gateway_debit_detect(c.id, p);
  end if;$n1$ in d) > 0 then
    d := replace(d, $n1$  update public.gateway_webhook_events set charge_id = c.id where id = e.id; -- 4026: o meio que o pagador USOU (pelo aviso e pelo valor líquido)
  if e.event in ('PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_DUNNING_RECEIVED') then
    perform public._gateway_debit_detect(c.id, p);
  end if;$n1$, $v1$  update public.gateway_webhook_events set charge_id = c.id where id = e.id;$v1$);
  end if;
  if d <> orig then execute d; end if;
end;
$do$;

do $do$
declare d text := pg_get_functiondef('public._gateway_apply_fee(uuid,bigint,date,uuid,text)'::regprocedure); orig text;
begin
  orig := d;
  if position($n1$when 'CREDIT_CARD_INSTALLMENT' then 'credito_parcelado' when 'DEBIT_CARD' then 'debito' else null end; -- 4026$n1$ in d) > 0 then
    d := replace(d, $n1$when 'CREDIT_CARD_INSTALLMENT' then 'credito_parcelado' when 'DEBIT_CARD' then 'debito' else null end; -- 4026$n1$, $v1$when 'CREDIT_CARD_INSTALLMENT' then 'credito_parcelado' else null end;$v1$);
  end if;
  if d <> orig then execute d; end if;
end;
$do$;

do $do$
declare d text := pg_get_functiondef('public._gateway_on_paid(uuid,text,jsonb)'::regprocedure); orig text;
begin
  orig := d;
  if position($n1$      case when c.paid_billing_type = 'DEBIT_CARD' then 'DEBIT_CARD' when c.installment_block is not null then 'CREDIT_CARD_INSTALLMENT' else c.billing_type end); -- 4026$n1$ in d) > 0 then
    d := replace(d, $n1$      case when c.paid_billing_type = 'DEBIT_CARD' then 'DEBIT_CARD' when c.installment_block is not null then 'CREDIT_CARD_INSTALLMENT' else c.billing_type end); -- 4026$n1$, $v1$      case when c.installment_block is not null then 'CREDIT_CARD_INSTALLMENT' else c.billing_type end);$v1$);
  end if;
  if d <> orig then execute d; end if;
end;
$do$;

do $do$
declare d text := pg_get_functiondef('public._gateway_split_retention(uuid)'::regprocedure); orig text;
begin
  orig := d;
  if position($n1$      if v_excess > v_tol and w.excess_cents is distinct from v_excess and coalesce(c.paid_billing_type, '') <> 'DEBIT_CARD' then -- 4026: o débito tem o caminho dele$n1$ in d) > 0 then
    d := replace(d, $n1$      if v_excess > v_tol and w.excess_cents is distinct from v_excess and coalesce(c.paid_billing_type, '') <> 'DEBIT_CARD' then -- 4026: o débito tem o caminho dele$n1$, $v1$      if v_excess > v_tol and w.excess_cents is distinct from v_excess then$v1$);
  end if;
  if d <> orig then execute d; end if;
end;
$do$;

do $do$
declare d text := pg_get_functiondef('public._franchise_monthly_build(uuid,date,uuid)'::regprocedure); orig text;
begin
  orig := d;
  if position($n1$  -- 4026 D) O CRÉDITO DO SPLIT A MAIS NO DÉBITO: o que o Asaas repassou a mais à
  -- rede num pagamento no débito sem a correção do split. É da unidade: entra
  -- como crédito; o que sobrar depois da cobrança paga entra no mês seguinte.
  for r in
    select x.id, x.fee, x.origin_month, x.amount_cents - x.used_cents as resta, ch.paid_on
      from public.split_excess_credits x join public.charges ch on ch.id = x.charge_id
     where x.clinic_id = p_clinic_id and x.status = 'a_devolver' and x.amount_cents - x.used_cents > 0
       and x.origin_month <= p_period
       and not exists (select 1 from public.franchise_monthly_items i join public.franchise_monthly_batches bb on bb.id = i.batch_id
                        where i.split_excess_credit_id = x.id and bb.id <> v_batch
                          and public._franchise_batch_holds(bb.status) and bb.settled_at is null)
     order by x.created_at
  loop
    insert into public.franchise_monthly_items (batch_id, clinic_id, kind, fee, origin_period, received_on, method,
      amount_cents, description, split_excess_credit_id)
    values (v_batch, p_clinic_id, 'credito', r.fee, r.origin_month, r.paid_on, 'cartao_debito', -r.resta,
      'Crédito — split a mais no débito', r.id);
  end loop;

  -- C) O SALDO ANTERIOR (20.15.1)$n1$ in d) > 0 then
    d := replace(d, $n1$  -- 4026 D) O CRÉDITO DO SPLIT A MAIS NO DÉBITO: o que o Asaas repassou a mais à
  -- rede num pagamento no débito sem a correção do split. É da unidade: entra
  -- como crédito; o que sobrar depois da cobrança paga entra no mês seguinte.
  for r in
    select x.id, x.fee, x.origin_month, x.amount_cents - x.used_cents as resta, ch.paid_on
      from public.split_excess_credits x join public.charges ch on ch.id = x.charge_id
     where x.clinic_id = p_clinic_id and x.status = 'a_devolver' and x.amount_cents - x.used_cents > 0
       and x.origin_month <= p_period
       and not exists (select 1 from public.franchise_monthly_items i join public.franchise_monthly_batches bb on bb.id = i.batch_id
                        where i.split_excess_credit_id = x.id and bb.id <> v_batch
                          and public._franchise_batch_holds(bb.status) and bb.settled_at is null)
     order by x.created_at
  loop
    insert into public.franchise_monthly_items (batch_id, clinic_id, kind, fee, origin_period, received_on, method,
      amount_cents, description, split_excess_credit_id)
    values (v_batch, p_clinic_id, 'credito', r.fee, r.origin_month, r.paid_on, 'cartao_debito', -r.resta,
      'Crédito — split a mais no débito', r.id);
  end loop;

  -- C) O SALDO ANTERIOR (20.15.1)$n1$, $v1$  -- C) O SALDO ANTERIOR (20.15.1)$v1$);
  end if;
  if d <> orig then execute d; end if;
end;
$do$;

do $do$
declare d text := pg_get_functiondef('public._franchise_monthly_settle(uuid)'::regprocedure); orig text;
begin
  orig := d;
  if position($n1$  v_method text;
  v_excess bigint := 0; v_comp_x bigint := 0; v_x_total bigint := 0; -- 4026$n1$ in d) > 0 then
    d := replace(d, $n1$  v_method text;
  v_excess bigint := 0; v_comp_x bigint := 0; v_x_total bigint := 0; -- 4026$n1$, $v1$  v_method text;$v1$);
  end if;
  if position($n2$   where batch_id = b.id and status in ('ativo', 'contestado') and amount_cents < 0 and split_excess_credit_id is null;
  -- 4026: o crédito do split a mais no débito é usado por último, e tem o razão dele.
  select coalesce(-sum(amount_cents), 0) into v_excess from public.franchise_monthly_items
   where batch_id = b.id and status in ('ativo', 'contestado') and amount_cents < 0 and split_excess_credit_id is not null;$n2$ in d) > 0 then
    d := replace(d, $n2$   where batch_id = b.id and status in ('ativo', 'contestado') and amount_cents < 0 and split_excess_credit_id is null;
  -- 4026: o crédito do split a mais no débito é usado por último, e tem o razão dele.
  select coalesce(-sum(amount_cents), 0) into v_excess from public.franchise_monthly_items
   where batch_id = b.id and status in ('ativo', 'contestado') and amount_cents < 0 and split_excess_credit_id is not null;$n2$, $v2$   where batch_id = b.id and status in ('ativo', 'contestado') and amount_cents < 0;$v2$);
  end if;
  if position($n3$    v_comp := least(r.amt, v_credit + v_excess); -- 4026
    v_comp_x := greatest(v_comp - v_credit, 0);
    v_excess := v_excess - v_comp_x;
    v_x_total := v_x_total + v_comp_x;
    if v_comp_x > 0 then perform public._split_excess_pay_payable(b.id, r.payable_id, v_comp_x, b.paid_on); end if;$n3$ in d) > 0 then
    d := replace(d, $n3$    v_comp := least(r.amt, v_credit + v_excess); -- 4026
    v_comp_x := greatest(v_comp - v_credit, 0);
    v_excess := v_excess - v_comp_x;
    v_x_total := v_x_total + v_comp_x;
    if v_comp_x > 0 then perform public._split_excess_pay_payable(b.id, r.payable_id, v_comp_x, b.paid_on); end if;$n3$, $v3$    v_comp := least(r.amt, v_credit);$v3$);
  end if;
  if position($n4$    v_credit := v_credit - (v_comp - v_comp_x); -- 4026$n4$ in d) > 0 then
    d := replace(d, $n4$    v_credit := v_credit - (v_comp - v_comp_x); -- 4026$n4$, $v4$    v_credit := v_credit - v_comp;$v4$);
  end if;
  if position($n5$  -- 4026: o crédito usado sai do "a receber da franqueadora" (o que sobrar fica para o mês seguinte).
  if v_x_total > 0 then perform public._split_excess_consume(b.id, b.clinic_id, v_x_total, b.paid_on); end if;

  -- Multa e juros: despesa financeira da unidade, receita financeira da franqueadora.$n5$ in d) > 0 then
    d := replace(d, $n5$  -- 4026: o crédito usado sai do "a receber da franqueadora" (o que sobrar fica para o mês seguinte).
  if v_x_total > 0 then perform public._split_excess_consume(b.id, b.clinic_id, v_x_total, b.paid_on); end if;

  -- Multa e juros: despesa financeira da unidade, receita financeira da franqueadora.$n5$, $v5$  -- Multa e juros: despesa financeira da unidade, receita financeira da franqueadora.$v5$);
  end if;
  if d <> orig then execute d; end if;
end;
$do$;

do $do$
declare d text := pg_get_functiondef('public._franchise_reconcile_found(uuid)'::regprocedure); orig text;
begin
  orig := d;
  if position($n1$     where c.clinic_id = p_clinic_id and cs.status = 'liquidado' and cs.excess_cents > v_tol and not exists (select 1 from public.split_excess_credits x where x.charge_split_id = cs.id and x.status <> 'cancelado') -- 4026: virou crédito da unidade$n1$ in d) > 0 then
    d := replace(d, $n1$     where c.clinic_id = p_clinic_id and cs.status = 'liquidado' and cs.excess_cents > v_tol and not exists (select 1 from public.split_excess_credits x where x.charge_split_id = cs.id and x.status <> 'cancelado') -- 4026: virou crédito da unidade$n1$, $v1$     where c.clinic_id = p_clinic_id and cs.status = 'liquidado' and cs.excess_cents > v_tol$v1$);
  end if;
  if d <> orig then execute d; end if;
end;
$do$;

do $do$
declare d text := pg_get_functiondef('public._central_readiness_raw(uuid)'::regprocedure); orig text;
begin
  orig := d;
  if position($n1$  select 'debito_conferido', -- 4026: a unidade escolhe (desabilitado ou habilitado)$n1$ in d) > 0 then
    d := replace(d, $n1$  select 'debito_conferido', -- 4026: a unidade escolhe (desabilitado ou habilitado)$n1$, $v1$  select 'debito_desabilitado',$v1$);
  end if;
  if position($n2$or v_acc.debit_disabled_declared_at is not null or v_acc.debit_enabled_declared_at is not null), false),$n2$ in d) > 0 then
    d := replace(d, $n2$or v_acc.debit_disabled_declared_at is not null or v_acc.debit_enabled_declared_at is not null), false),$n2$, $v2$or v_acc.debit_disabled_declared_at is not null), false),$v2$);
  end if;
  if d <> orig then execute d; end if;
end;
$do$;

do $do$
declare d text := pg_get_functiondef('public.gateway_charges_list(uuid,text[],text[],text,date,date,boolean)'::regprocedure); orig text;
begin
  orig := d;
  if position($n1$         pi.seq, coalesce(ch.paid_billing_type, ch.billing_type), ch.status, ch.is_overdue_reissue, -- 4026: o meio usado$n1$ in d) > 0 then
    d := replace(d, $n1$         pi.seq, coalesce(ch.paid_billing_type, ch.billing_type), ch.status, ch.is_overdue_reissue, -- 4026: o meio usado$n1$, $v1$         pi.seq, ch.billing_type, ch.status, ch.is_overdue_reissue,$v1$);
  end if;
  if d <> orig then execute d; end if;
end;
$do$;

do $do$
declare d text := pg_get_functiondef('public._franchise_month_invoiced(uuid,date)'::regprocedure); orig text;
begin
  orig := d;
  if position($n1$     and i.status in ('ativo', 'contestado') and i.split_excess_credit_id is null -- 4026: o crédito do débito não é taxa (é o 6.4.01)
     and public._franchise_batch_holds(b.status);$n1$ in d) > 0 then
    d := replace(d, $n1$     and i.status in ('ativo', 'contestado') and i.split_excess_credit_id is null -- 4026: o crédito do débito não é taxa (é o 6.4.01)
     and public._franchise_batch_holds(b.status);$n1$, $v1$     and i.status in ('ativo', 'contestado') and public._franchise_batch_holds(b.status);$v1$);
  end if;
  if d <> orig then execute d; end if;
end;
$do$;

do $do$
declare d text := pg_get_functiondef('public.gateway_receivables_due(uuid)'::regprocedure); orig text;
begin
  orig := d;
  if position($n1$         coalesce(ch.paid_billing_type, ch.billing_type), ch.paid_on, ch.credit_date, -- 4026: o meio usado$n1$ in d) > 0 then
    d := replace(d, $n1$         coalesce(ch.paid_billing_type, ch.billing_type), ch.paid_on, ch.credit_date, -- 4026: o meio usado$n1$, $v1$         ch.billing_type, ch.paid_on, ch.credit_date,$v1$);
  end if;
  if d <> orig then execute d; end if;
end;
$do$;

create or replace function public.gateway_asaas_migrations()
returns table (code text, label text, applied boolean, sort_order integer)
language sql stable security definer set search_path = '' as $$
  with m(code, label, kind, obj, sort_order) as (values
    ('4000', 'Fundação: contas e Vault', 'table', 'gateway_settings', 1),
    ('4001', 'Tarifas no adquirente', 'fn', '_gateway_sync_fees', 2),
    ('4002', 'Prontidão, histórico e verificação', 'table', 'central_unit_readiness', 3),
    ('4003', 'Responsável financeiro e carência', 'col', 'client_guardians.is_financial', 4),
    ('4004', 'Cobranças, travas e dispensa', 'table', 'gateway_customers', 5),
    ('4005', 'O aviso vira baixa', 'table', 'gateway_payment_surpluses', 6),
    ('4006', 'Selo em atraso e painel de cobranças', 'fn', '_overdue_badge_business_days', 7),
    ('4007', 'A régua de avisos', 'table', 'gateway_notification_rules', 8),
    ('4008', 'O split na emissão', 'table', 'gateway_split_settings', 9),
    ('4009', 'A fila do split e o estorno', 'table', 'charge_split_updates', 10),
    ('4010', 'Repasses da franquia', 'fn', '_franchise_payout_charge_fees', 11),
    ('4011', 'Meio por parcela, dinheiro e permuta', 'table', 'sale_method_settings', 12),
    ('4012', 'Cobrança na assinatura e rotina', 'table', 'gateway_auto_charge_settings', 13),
    ('4013', 'Cartão parcelado', 'fn', 'charges_card_block_rule', 14),
    ('4014', 'Parcelado: devolução, contestação e avisos', 'table', 'card_block_returns', 15),
    ('4015', 'Todos os boletos agora', 'table', 'gateway_carne_customers', 16),
    ('4015a', 'Recusa de cancelar venda com acordo aberto', 'fn', '_sale_open_agreements', 17),
    ('4017', 'Renegociação assinada', 'table', 'payment_renegotiation_events', 18),
    ('4017a', 'Exceção: cancelar venda com acordo', 'table', 'sale_cancel_exceptions', 19),
    ('4018', 'Mensalidades pelo Asaas', 'table', 'charge_source_types', 20),
    ('4018a', 'A marca do split a mais', 'body', '_gateway_split_retention|4018a', 21),
    ('4018b', 'A conta cancelada à mão', 'body', 'refresh_network_fee_payable|Sem valor apurado', 22),
    ('4018c', 'A taxa retida no razão', 'fn', '_split_charges_after_born', 23),
    ('4020', 'Distrato com checklist', 'table', 'distrato_requests', 24),
    ('4020a', 'Estorno de parte pelo Asaas', 'table', 'refund_requests', 25),
    ('4021', 'Cobrança mensal da rede', 'table', 'franchise_billing_settings', 26),
    ('4021a', 'Conferência das taxas', 'table', 'reconciliation_issues', 27),
    ('4022', 'As peças do piloto', 'table', 'gateway_charge_issues', 28),
    ('4023', 'O Empresarial pelo Asaas', 'table', 'corporate_gateway_settings', 29),
    ('4024', 'A antecipação vira alerta', 'body', '_central_readiness_raw|antecipacao_conferida', 30),
    ('4025', 'A conta da RisLife só para quem a cadastrou', 'col', 'gateway_accounts.visible_only_to', 31)
  )
  select m.code, m.label,
         case m.kind
           when 'table' then exists (select 1 from information_schema.tables t where t.table_schema = 'public' and t.table_name = m.obj)
           when 'fn' then exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = m.obj)
           when 'col' then exists (select 1 from information_schema.columns c where c.table_schema = 'public'
                                     and c.table_name = split_part(m.obj, '.', 1) and c.column_name = split_part(m.obj, '.', 2))
           when 'body' then exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                     where n.nspname = 'public' and p.proname = split_part(m.obj, '|', 1)
                                       and position(split_part(m.obj, '|', 2) in p.prosrc) > 0)
         end,
         m.sort_order
    from m order by m.sort_order;
$$;
revoke execute on function public.gateway_asaas_migrations() from public, anon, authenticated;

notify pgrst, 'reload schema';

select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and position('4026' in p.prosrc) > 0
      and p.proname in ('_gateway_apply_event', '_gateway_apply_fee', '_gateway_on_paid', '_gateway_split_retention',
                        '_franchise_monthly_build', '_franchise_monthly_settle', '_franchise_reconcile_found',
                        '_central_readiness_raw', 'gateway_charges_list', '_franchise_month_invoiced',
                        'gateway_receivables_due')) as funcoes_com_a_4026,
  (select count(*) from public.gateway_asaas_migrations()) as migracoes_na_lista;
