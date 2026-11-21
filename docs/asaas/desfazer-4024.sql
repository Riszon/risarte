-- DESFAZER a 4024 (só se precisar). Roda inteiro, de uma vez, no SQL Editor.
-- Volta a regra antiga: a antecipação automática ligada tira a unidade de
-- "Pronta para cobrar". A marca que cair com isso não volta sozinha.

create or replace function public._central_readiness_raw(p_clinic_id uuid)
returns table(item text, ok boolean, sort_order integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_acc public.gateway_accounts%rowtype;
  v_today date := public.today_br();
  v_has_account boolean;
begin
  select a.* into v_acc
    from public.gateway_accounts a
   where a.id = public._gateway_account_of(p_clinic_id);
  v_has_account := found;

  return query
  select 'conta_validada'::text,
         coalesce(v_has_account and v_acc.status = 'active' and v_acc.last_check_ok is not false, false),
         10
  union all
  select 'wallet_id',
         coalesce(v_has_account and length(coalesce(v_acc.wallet_id, '')) > 0, false),
         20
  union all
  select 'webhook_ativo',
         coalesce(v_has_account and v_acc.webhook_id is not null and v_acc.webhook_token_secret_id is not null
                  and v_acc.webhook_events_ok is not false, false),
         30
  union all
  select 'tarifas',
         coalesce(v_has_account and exists (
           select 1
             from public.card_acquirers c
             join public.acquirer_rates r on r.acquirer_id = c.id
            where c.gateway_account_id = v_acc.id
              and r.valid_from <= v_today
              and (r.valid_to is null or r.valid_to >= v_today)
         ), false),
         40
  union all
  select 'chave_pix',
         coalesce(v_has_account and v_acc.pix_key_active is true, false),
         50
  union all
  select 'split_habilitado',
         coalesce(v_has_account and (v_acc.split_enabled_confirmed_at is not null
                                     or v_acc.split_enabled_declared_at is not null), false),
         60
  union all
  select 'termo_registrado',
         coalesce(v_has_account and (v_acc.owner_type = 'franchisor'
                                     or v_acc.term_registered_at is not null), false),
         70
  union all
  select 'antecipacao_desligada',
         coalesce(v_has_account and v_acc.anticipation_auto_enabled is false, false),
         80
  union all
  -- 4022 (19.37 item 2): o débito desabilitado no painel do Asaas, marcado pelo Admin Master.
  select 'debito_desabilitado',
         coalesce(v_has_account and (v_acc.owner_type = 'franchisor' or v_acc.debit_disabled_declared_at is not null), false),
         90
  union all
  -- 4022 (21.7 item 2): a chave de PRODUÇÃO com as permissões mínimas — a marca
  -- do Admin Master e a sonda do servidor (as três leituras proibidas recusadas).
  -- No sandbox não se aplica.
  select 'chave_permissoes_minimas',
         coalesce(v_has_account and (v_acc.environment <> 'production'
                                     or (v_acc.key_min_perm_declared_at is not null and v_acc.key_perm_probe_ok is true)), false),
         100
  union all
  -- 4022 (2a): o levantamento do que já existe no Asaas da conta, feito.
  select 'levantamento_feito',
         coalesce(v_has_account and (v_acc.owner_type = 'franchisor'
                                     or exists (select 1 from public.gateway_account_surveys s where s.account_id = v_acc.id and s.ok)), false),
         110;
end;
$$;

do $$
declare v_def text := pg_get_functiondef('public._gateway_record_check(uuid,boolean,text,jsonb,date,boolean,boolean)'::regprocedure);
begin
  if position('Não trava a cobrança, mas a taxa da antecipação sai antes do split: a diferença da taxa da rede vira conta a pagar da unidade. Veja o alerta na Central.' in v_def) > 0 then
    execute replace(v_def, 'Não trava a cobrança, mas a taxa da antecipação sai antes do split: a diferença da taxa da rede vira conta a pagar da unidade. Veja o alerta na Central.',
      'Ela reduz o repasse do split; desligue no painel do Asaas.');
  end if;
end;
$$;

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
    ('4023', 'O Empresarial pelo Asaas', 'table', 'corporate_gateway_settings', 29)
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
  (select count(*) from public._central_readiness_raw(null) where item = 'antecipacao_desligada') as item_antigo_de_volta,
  (select count(*) from public.gateway_asaas_migrations()) as migracoes_na_lista;
