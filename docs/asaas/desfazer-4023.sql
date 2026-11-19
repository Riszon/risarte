-- DESFAZER a 4023 (só se precisar). Roda inteiro, de uma vez, no SQL Editor.
--
-- Tira as funções, o gatilho e a regra de leitura da 4023, devolve o aviso do
-- Asaas e a trava do funil como eram, solta as duas regras novas (a implantação
-- em 100% e o contato do outro pagador) e devolve a lista das migrações da 4022.
-- O LEGADO volta VAZIO (a tabela e a coluna antigas, sem dado: não tinham).
-- Ficam, com o que tiver sido gravado (não apaga dado): as tabelas
-- corporate_gateway_settings, corporate_charges e corporate_monthly_reports, as
-- colunas dependents_payer_email e dependents_payer_phone e as cobranças em
-- public.charges. As regras de split que viraram 100 continuam 100 (o antes
-- está na auditoria, entity_type 'empresarial_split_rule').
--
-- ⚠️ Cobrança do Empresarial viva no Asaas continua viva lá: cancele no painel
-- do Asaas antes, se for o caso.

drop trigger if exists adhesion_billing_gateway_lock on empresarial.adhesion_billing;
drop policy if exists "charges_select_corporate" on public.charges;

-- O aviso do Asaas sem o ramo do Empresarial.
do $$
declare v_def text := pg_get_functiondef('public._gateway_apply_event(bigint)'::regprocedure);
  v_branch text := E'  -- 4023 (ASA5): as cobranças do Empresarial têm o ramo delas.\n'
    || E'  if c.source_type in (''corporate_implementation'', ''corporate_monthly'') and to_regprocedure(''public._corporate_event(uuid,text,jsonb)'') is not null then\n'
    || E'    return public._corporate_event(c.id, e.event, p);\n'
    || E'  end if;\n';
begin
  if position(v_branch in v_def) > 0 then execute replace(v_def, v_branch, ''); end if;
end;
$$;

-- A trava do funil como era na 1041.
do $$
declare v_def text := pg_get_functiondef('empresarial.guard_lead_signatures()'::regprocedure);
  v_novo text := E'  -- 4023 (ASA5): a baixa pelo aviso do Asaas sela o pagamento do lead.\n'
    || E'  if coalesce(current_setting(''risarte.baixa_do_asaas'', true), '''') <> ''1'' and (';
begin
  if position(v_novo in v_def) > 0 then execute replace(v_def, v_novo, '  if ('); end if;
end;
$$;

drop function if exists public.corporate_charge_prepare(uuid, boolean);
drop function if exists public.corporate_charge_retry(uuid);
drop function if exists public.corporate_lead_implantation_issue(uuid, bigint, date);
drop function if exists public.corporate_live_charge(uuid);
drop function if exists public.corporate_refund_check(uuid);
drop function if exists public.corporate_billing_charges(uuid);
drop function if exists public.corporate_settings_read();
drop function if exists public.corporate_settings_save(date, uuid);
drop function if exists public._corporate_event(uuid, text, jsonb);
drop function if exists public._corporate_billing_lock();
drop function if exists public._corporate_payer_of(uuid);
drop function if exists public._corporate_payer(uuid);
drop function if exists public._corporate_payer_save(uuid, text);
drop function if exists public._corporate_split_plan(uuid);
drop function if exists public._corporate_charge_report(uuid, uuid, text);
drop function if exists public._corporate_report_save(uuid, jsonb, uuid);
drop function if exists public._corporate_report_by_code(text);
drop function if exists public._corporate_mark_refunded(uuid);
drop function if exists public._corporate_pending_registrations();
drop function if exists public._corporate_overdue_divergences();
drop function if exists public._corporate_rislife_account();
drop function if exists public._corporate_can_configure();
drop function if exists public._corporate_can_manage();

alter table empresarial.split_rules drop constraint if exists split_rules_implantacao_rislife_check;
alter table empresarial.employees drop constraint if exists employees_dependents_payer_contact_check;

-- O legado volta vazio (como era na 0097 e na 0102).
alter table empresarial.adhesion_billing add column if not exists asaas_billing_id varchar(100);
create table if not exists empresarial.asaas_webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_id varchar(120) unique not null,
  event_type varchar(60),
  payload jsonb,
  processed_at timestamptz not null default now()
);
alter table empresarial.asaas_webhook_events enable row level security;
grant all on empresarial.asaas_webhook_events to service_role;
insert into public.audit_excluded_tables (schema_name, table_name, motivo)
values ('empresarial', 'asaas_webhook_events', 'Retorno técnico do ASAAS')
on conflict (schema_name, table_name) do nothing;

-- A lista das migrações do Asaas como era na 4022.
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
    ('4022', 'As peças do piloto', 'table', 'gateway_charge_issues', 28)
  )
  select m.code, m.label,
         case m.kind
           when 'table' then exists (select 1 from information_schema.tables t where t.table_schema = 'public' and t.table_name = m.obj)
           when 'fn' then exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = m.obj)
           when 'col' then exists (select 1 from information_schema.columns c where c.table_schema = 'public'
                                     and c.table_name = split_part(m.obj, '.', 1) and c.column_name = split_part(m.obj, '.', 2))
           -- sem objeto novo: a marca é um trecho da função que ela redefiniu
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
    where n.nspname = 'public' and (p.proname like 'corporate\_%' or p.proname like '\_corporate\_%')) as funcoes_restantes,
  position('_corporate_event' in pg_get_functiondef('public._gateway_apply_event(bigint)'::regprocedure)) = 0 as aviso_como_antes,
  position('risarte.baixa_do_asaas' in pg_get_functiondef('empresarial.guard_lead_signatures()'::regprocedure)) = 0 as funil_como_antes,
  (select count(*) from public.gateway_asaas_migrations()) as migracoes_na_lista;
