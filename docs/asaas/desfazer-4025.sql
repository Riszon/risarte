-- DESFAZER a 4025 (só se precisar). Roda inteiro, de uma vez, no SQL Editor.
-- A conta da RisLife volta a aparecer para todo Admin Master e todo Financeiro
-- da Franqueadora. A coluna visible_only_to fica (sem efeito), com o que tiver.

drop trigger if exists gateway_accounts_rislife_private on public.gateway_accounts;
drop function if exists public._gateway_rislife_private();

drop policy if exists "gateway_accounts_select" on public.gateway_accounts;
create policy "gateway_accounts_select" on public.gateway_accounts
  for select to authenticated
  using (
    public.is_admin_master()
    or public.is_finance_franchisor()
    or (
      clinic_id is not null
      and public.has_role_in_clinic(clinic_id, array['unit_manager']::public.user_role[])
    )
  );
drop policy if exists "audit_changes_select_admin" on public.audit_changes;
create policy "audit_changes_select_admin" on public.audit_changes
  for select to authenticated using (public.is_admin_master());
drop policy if exists "audit_logs_select_admin" on public.audit_logs;
create policy "audit_logs_select_admin" on public.audit_logs
  for select to authenticated using (public.is_admin_master());

do $do$
declare d text := pg_get_functiondef('public.central_history(text,uuid)'::regprocedure); orig text;
begin
  orig := d;
  if position($n1$             where (p_clinic_id is null and g.owner_type in ('franchisor', 'recipient') and not public._gateway_account_hidden(g.id))$n1$ in d) > 0 then
    d := replace(d, $n1$             where (p_clinic_id is null and g.owner_type in ('franchisor', 'recipient') and not public._gateway_account_hidden(g.id))$n1$, $v1$             where (p_clinic_id is null and g.owner_type in ('franchisor', 'recipient'))$v1$);
  end if;
  if d <> orig then execute d; end if;
end;
$do$;

do $do$
declare d text := pg_get_functiondef('public.gateway_split_read()'::regprocedure); orig text;
begin
  orig := d;
  if position($n1$                   where g.owner_type in ('franchisor', 'recipient') and g.status = 'active' and not public._gateway_account_hidden(g.id)));$n1$ in d) > 0 then
    d := replace(d, $n1$                   where g.owner_type in ('franchisor', 'recipient') and g.status = 'active' and not public._gateway_account_hidden(g.id)));$n1$, $v1$                   where g.owner_type in ('franchisor', 'recipient') and g.status = 'active'));$v1$);
  end if;
  if d <> orig then execute d; end if;
end;
$do$;

do $do$
declare d text := pg_get_functiondef('public.gateway_split_save(integer,numeric,numeric,jsonb)'::regprocedure); orig text;
begin
  orig := d;
  if position($n1$       where g.id = v_acc and g.owner_type in ('franchisor', 'recipient') and g.status = 'active' and not public._gateway_account_hidden(g.id)) then$n1$ in d) > 0 then
    d := replace(d, $n1$       where g.id = v_acc and g.owner_type in ('franchisor', 'recipient') and g.status = 'active' and not public._gateway_account_hidden(g.id)) then$n1$, $v1$       where g.id = v_acc and g.owner_type in ('franchisor', 'recipient') and g.status = 'active') then$v1$);
  end if;
  if d <> orig then execute d; end if;
end;
$do$;

do $do$
declare d text := pg_get_functiondef('public.corporate_settings_read()'::regprocedure); orig text;
begin
  orig := d;
  if position($n1$    'rislife_account_id', case when public._gateway_account_hidden(s.rislife_account_id) then null else s.rislife_account_id end,$n1$ in d) > 0 then
    d := replace(d, $n1$    'rislife_account_id', case when public._gateway_account_hidden(s.rislife_account_id) then null else s.rislife_account_id end,$n1$, $v1$    'rislife_account_id', s.rislife_account_id,$v1$);
  end if;
  if position($n2$                       from public.gateway_accounts a where a.owner_type = 'recipient' and a.status <> 'disabled' and not public._gateway_account_hidden(a.id)), '[]'::jsonb),$n2$ in d) > 0 then
    d := replace(d, $n2$                       from public.gateway_accounts a where a.owner_type = 'recipient' and a.status <> 'disabled' and not public._gateway_account_hidden(a.id)), '[]'::jsonb),$n2$, $v2$                       from public.gateway_accounts a where a.owner_type = 'recipient' and a.status <> 'disabled'), '[]'::jsonb),$v2$);
  end if;
  if d <> orig then execute d; end if;
end;
$do$;

do $do$
declare d text := pg_get_functiondef('public.corporate_settings_save(date,uuid)'::regprocedure); orig text;
begin
  orig := d;
  if position($n1$if not public._corporate_can_configure() then raise exception 'NOT_ALLOWED'; end if; if public._gateway_account_hidden((select c.rislife_account_id from public.corporate_gateway_settings c where c.id)) or public._gateway_account_hidden(p_rislife_account_id) then raise exception 'RISLIFE_ACCOUNT_HIDDEN'; end if; -- 4025$n1$ in d) > 0 then
    d := replace(d, $n1$if not public._corporate_can_configure() then raise exception 'NOT_ALLOWED'; end if; if public._gateway_account_hidden((select c.rislife_account_id from public.corporate_gateway_settings c where c.id)) or public._gateway_account_hidden(p_rislife_account_id) then raise exception 'RISLIFE_ACCOUNT_HIDDEN'; end if; -- 4025$n1$, $v1$if not public._corporate_can_configure() then raise exception 'NOT_ALLOWED'; end if;$v1$);
  end if;
  if d <> orig then execute d; end if;
end;
$do$;

do $do$
declare d text := pg_get_functiondef('public.gateway_surveys_read(uuid)'::regprocedure); orig text;
begin
  orig := d;
  if position($n1$if not (public.is_admin_master() or public.is_finance_franchisor()) then raise exception 'NOT_ALLOWED'; end if; if public._gateway_account_hidden(p_account_id) then return '[]'::jsonb; end if; -- 4025$n1$ in d) > 0 then
    d := replace(d, $n1$if not (public.is_admin_master() or public.is_finance_franchisor()) then raise exception 'NOT_ALLOWED'; end if; if public._gateway_account_hidden(p_account_id) then return '[]'::jsonb; end if; -- 4025$n1$, $v1$if not (public.is_admin_master() or public.is_finance_franchisor()) then raise exception 'NOT_ALLOWED'; end if;$v1$);
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
    ('4024', 'A antecipação vira alerta', 'body', '_central_readiness_raw|antecipacao_conferida', 30)
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
    where n.nspname = 'public' and position('_gateway_account_hidden' in p.prosrc) > 0
      and p.proname not in ('_gateway_account_hidden', '_gateway_account_hidden_text')) as funcoes_com_a_trava,
  (select count(*) from public.gateway_asaas_migrations()) as migracoes_na_lista;
