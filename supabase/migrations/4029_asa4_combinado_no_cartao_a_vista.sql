-- 4029 — O COMBINADO NO CARTÃO À VISTA: DÉBITO OU CRÉDITO (relato do dono, 27/11/2026)
--
-- Na venda direta, o cartão à vista pelo Asaas é uma cobrança só, e a fatura do
-- Asaas oferece crédito e débito (a API não cria cobrança só de débito). O caixa
-- passa a ter dois botões, "Débito" e "Crédito à vista": a escolha fica gravada
-- aqui, como o COMBINADO. O meio que o paciente usou de verdade continua vindo
-- do Asaas (`charges.paid_billing_type`, 4026). A tela mostra os dois.
--
-- Uma coluna nova (nula nas vendas que já existem), a porta que a grava (o app
-- não escreve direto na venda direta — AP139) e a lista de migrações.
-- Roda duas vezes sem erro. Desfazer: docs/asaas/desfazer-4029.sql.

alter table public.direct_sales add column if not exists card_choice text;
alter table public.direct_sales drop constraint if exists direct_sales_card_choice_check;
alter table public.direct_sales add constraint direct_sales_card_choice_check
  check (card_choice is null or card_choice in ('debito', 'credito'));
comment on column public.direct_sales.card_choice is
  '4029: o combinado no cartão à vista (debito | credito). O meio usado de verdade está em charges.paid_billing_type.';

-- A PORTA: quem fecha a venda direta (a mesma regra das condições) grava ou
-- limpa o combinado, só em venda aberta. Fora do cartão à vista, só limpa.
create or replace function public.direct_sale_set_card_choice(p_sale_id uuid, p_choice text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.direct_sales%rowtype;
begin
  select * into v from public.direct_sales s where s.id = p_sale_id;
  if v.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.direct_sale_can_close(v.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  if v.closed_at is not null then raise exception 'ALREADY_CLOSED'; end if;
  if coalesce(v.cancelled, false) then raise exception 'SALE_CANCELLED'; end if;
  if p_choice is not null and p_choice not in ('debito', 'credito') then raise exception 'INVALID_CHOICE'; end if;
  if p_choice is not null and coalesce(v.payment_method, '') <> 'cartao' then raise exception 'NOT_CARD'; end if;
  update public.direct_sales set card_choice = p_choice, updated_at = now()
   where id = p_sale_id and card_choice is distinct from p_choice;
end;
$$;
revoke execute on function public.direct_sale_set_card_choice(uuid, text) from public, anon, authenticated;
grant execute on function public.direct_sale_set_card_choice(uuid, text) to authenticated;

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
    ('4025', 'A conta da RisLife só para quem a cadastrou', 'col', 'gateway_accounts.visible_only_to', 31),
    ('4026', 'O pagamento no cartão de débito', 'col', 'charges.paid_billing_type', 32),
    ('4027', 'Parcelamento cancelado à mão não oferece "Gerar"', 'body', '_card_block_summary|cancelado_a_mao', 33),
    ('4028', 'O cartão à vista na venda direta', 'body', 'direct_sales_method_rule|4028', 34),
    ('4029', 'O combinado no cartão à vista (débito ou crédito)', 'col', 'direct_sales.card_choice', 35)
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
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'direct_sales' and column_name = 'card_choice') as coluna,
  (has_function_privilege('authenticated', 'public.direct_sale_set_card_choice(uuid,text)', 'execute')
   and not has_function_privilege('anon', 'public.direct_sale_set_card_choice(uuid,text)', 'execute')) as porta,
  (select applied from public.gateway_asaas_migrations() where code = '4029') as na_lista;
