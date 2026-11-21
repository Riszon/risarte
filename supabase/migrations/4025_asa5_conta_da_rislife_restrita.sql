-- 4025 — A CONTA DA RISLIFE SÓ PARA QUEM A CADASTROU (Asaas 0.25.0; pedido do dono, 21/11/2026)
--
-- Até a 4024, a conta Asaas da RisLife (owner_type 'recipient') aparecia para
-- todo Admin Master e todo Financeiro da Franqueadora. O dono decidiu (opção
-- "só a conta"): o CADASTRO da conta da RisLife (CNPJ, carteira, situação,
-- conferências, levantamento, histórico e auditoria dela) fica só com quem a
-- cadastrou. As COBRANÇAS do Empresarial continuam como estão (o Financeiro
-- opera e acompanha as implantações).
--
-- Como:
--   * `gateway_accounts.visible_only_to`: preenchido, só essa pessoa enxerga a
--     conta. O servidor (chave de serviço, sem pessoa) enxerga sempre: a
--     emissão, o aviso do Asaas e a verificação semanal não mudam;
--   * a conta real da RisLife (produção) recebe quem a cadastrou; uma conta da
--     RisLife cadastrada depois já nasce assim (gatilho), e não nasce uma
--     segunda no mesmo ambiente;
--   * a leitura das contas, a auditoria, o histórico da Central, as carteiras da
--     aba Taxas, a aba Empresarial e o levantamento escondem a conta de quem não
--     é a pessoa; e quem não a enxerga não configura o Empresarial pelo Asaas.

alter table public.gateway_accounts add column if not exists visible_only_to uuid references public.profiles(id);
comment on column public.gateway_accounts.visible_only_to is
  '4025: preenchido, só esta pessoa enxerga a conta (a da RisLife: quem a cadastrou). O servidor enxerga sempre.';

-- A conta está escondida de QUEM PERGUNTA? (sem pessoa = servidor: nunca)
create or replace function public._gateway_account_hidden(p_account_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.gateway_accounts g
     where g.id = p_account_id and g.visible_only_to is not null and g.visible_only_to <> (select auth.uid()));
$$;
create or replace function public._gateway_account_hidden_text(p_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(p_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', false)
     and public._gateway_account_hidden(p_id::uuid);
$$;
revoke execute on function public._gateway_account_hidden(uuid) from public, anon, authenticated;
revoke execute on function public._gateway_account_hidden_text(text) from public, anon, authenticated;
-- As regras de leitura chamam estas (só dizem "sim" ou "não" para quem pergunta).
grant execute on function public._gateway_account_hidden(uuid) to authenticated;
grant execute on function public._gateway_account_hidden_text(text) to authenticated;

-- A leitura das contas (regra da 4000) + a conta restrita.
drop policy if exists "gateway_accounts_select" on public.gateway_accounts;
create policy "gateway_accounts_select" on public.gateway_accounts
  for select to authenticated
  using (
    (visible_only_to is null or visible_only_to = (select auth.uid()))
    and (
      public.is_admin_master()
      or public.is_finance_franchisor()
      or (
        clinic_id is not null
        and public.has_role_in_clinic(clinic_id, array['unit_manager']::public.user_role[])
      )
    )
  );

-- A auditoria (0288 e 0001): o Admin Master lê tudo, menos o que é da conta restrita.
drop policy if exists "audit_changes_select_admin" on public.audit_changes;
create policy "audit_changes_select_admin" on public.audit_changes
  for select to authenticated
  using (public.is_admin_master()
         and not (table_name = 'gateway_accounts' and public._gateway_account_hidden_text(row_id)));
drop policy if exists "audit_logs_select_admin" on public.audit_logs;
create policy "audit_logs_select_admin" on public.audit_logs
  for select to authenticated
  using (public.is_admin_master()
         and not (coalesce(entity_type, '') like 'gateway%' and public._gateway_account_hidden_text(entity_id)));

-- A conta da RisLife: nasce restrita a quem a cadastra, e uma só por ambiente.
create or replace function public._gateway_rislife_private()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.owner_type = 'recipient' and new.label ilike 'RisLife%' then
    if exists (select 1 from public.gateway_accounts g
                where g.owner_type = 'recipient' and g.label ilike 'RisLife%'
                  and g.environment = new.environment and g.status <> 'disabled') then
      raise exception 'ACCOUNT_ALREADY_EXISTS';
    end if;
    if new.visible_only_to is null then new.visible_only_to := new.created_by; end if;
  end if;
  return new;
end;
$$;
revoke execute on function public._gateway_rislife_private() from public, anon, authenticated;
drop trigger if exists gateway_accounts_rislife_private on public.gateway_accounts;
create trigger gateway_accounts_rislife_private before insert on public.gateway_accounts
  for each row execute function public._gateway_rislife_private();

-- A conta real da RisLife que já existe: só para quem a cadastrou.
update public.gateway_accounts
   set visible_only_to = created_by
 where owner_type = 'recipient' and label ilike 'RisLife%' and environment = 'production'
   and visible_only_to is null and created_by is not null;

-- As funções que mostram contas a quem está logado (troca por âncora, sem reescrever).
do $do$
declare d text := pg_get_functiondef('public.central_history(text,uuid)'::regprocedure); orig text;
begin
  orig := d;
  if position($n1$             where (p_clinic_id is null and g.owner_type in ('franchisor', 'recipient') and not public._gateway_account_hidden(g.id))$n1$ in d) = 0 then
    if position($v1$             where (p_clinic_id is null and g.owner_type in ('franchisor', 'recipient'))$v1$ in d) = 0 then raise exception 'ANCORA_FALTANDO: central_history (1)'; end if;
    d := replace(d, $v1$             where (p_clinic_id is null and g.owner_type in ('franchisor', 'recipient'))$v1$, $n1$             where (p_clinic_id is null and g.owner_type in ('franchisor', 'recipient') and not public._gateway_account_hidden(g.id))$n1$);
  end if;
  if d <> orig then execute d; end if;
end;
$do$;

do $do$
declare d text := pg_get_functiondef('public.gateway_split_read()'::regprocedure); orig text;
begin
  orig := d;
  if position($n1$                   where g.owner_type in ('franchisor', 'recipient') and g.status = 'active' and not public._gateway_account_hidden(g.id)));$n1$ in d) = 0 then
    if position($v1$                   where g.owner_type in ('franchisor', 'recipient') and g.status = 'active'));$v1$ in d) = 0 then raise exception 'ANCORA_FALTANDO: gateway_split_read (1)'; end if;
    d := replace(d, $v1$                   where g.owner_type in ('franchisor', 'recipient') and g.status = 'active'));$v1$, $n1$                   where g.owner_type in ('franchisor', 'recipient') and g.status = 'active' and not public._gateway_account_hidden(g.id)));$n1$);
  end if;
  if d <> orig then execute d; end if;
end;
$do$;

do $do$
declare d text := pg_get_functiondef('public.gateway_split_save(integer,numeric,numeric,jsonb)'::regprocedure); orig text;
begin
  orig := d;
  if position($n1$       where g.id = v_acc and g.owner_type in ('franchisor', 'recipient') and g.status = 'active' and not public._gateway_account_hidden(g.id)) then$n1$ in d) = 0 then
    if position($v1$       where g.id = v_acc and g.owner_type in ('franchisor', 'recipient') and g.status = 'active') then$v1$ in d) = 0 then raise exception 'ANCORA_FALTANDO: gateway_split_save (1)'; end if;
    d := replace(d, $v1$       where g.id = v_acc and g.owner_type in ('franchisor', 'recipient') and g.status = 'active') then$v1$, $n1$       where g.id = v_acc and g.owner_type in ('franchisor', 'recipient') and g.status = 'active' and not public._gateway_account_hidden(g.id)) then$n1$);
  end if;
  if d <> orig then execute d; end if;
end;
$do$;

do $do$
declare d text := pg_get_functiondef('public.corporate_settings_read()'::regprocedure); orig text;
begin
  orig := d;
  if position($n1$    'rislife_account_id', case when public._gateway_account_hidden(s.rislife_account_id) then null else s.rislife_account_id end,$n1$ in d) = 0 then
    if position($v1$    'rislife_account_id', s.rislife_account_id,$v1$ in d) = 0 then raise exception 'ANCORA_FALTANDO: corporate_settings_read (1)'; end if;
    d := replace(d, $v1$    'rislife_account_id', s.rislife_account_id,$v1$, $n1$    'rislife_account_id', case when public._gateway_account_hidden(s.rislife_account_id) then null else s.rislife_account_id end,$n1$);
  end if;
  if position($n2$                       from public.gateway_accounts a where a.owner_type = 'recipient' and a.status <> 'disabled' and not public._gateway_account_hidden(a.id)), '[]'::jsonb),$n2$ in d) = 0 then
    if position($v2$                       from public.gateway_accounts a where a.owner_type = 'recipient' and a.status <> 'disabled'), '[]'::jsonb),$v2$ in d) = 0 then raise exception 'ANCORA_FALTANDO: corporate_settings_read (2)'; end if;
    d := replace(d, $v2$                       from public.gateway_accounts a where a.owner_type = 'recipient' and a.status <> 'disabled'), '[]'::jsonb),$v2$, $n2$                       from public.gateway_accounts a where a.owner_type = 'recipient' and a.status <> 'disabled' and not public._gateway_account_hidden(a.id)), '[]'::jsonb),$n2$);
  end if;
  if d <> orig then execute d; end if;
end;
$do$;

do $do$
declare d text := pg_get_functiondef('public.corporate_settings_save(date,uuid)'::regprocedure); orig text;
begin
  orig := d;
  if position($n1$  if not public._corporate_can_configure() then raise exception 'NOT_ALLOWED'; end if;
  -- 4025: a conta da RisLife só aparece para quem a cadastrou; quem não a enxerga não configura.
  if public._gateway_account_hidden((select c.rislife_account_id from public.corporate_gateway_settings c where c.id))
     or public._gateway_account_hidden(p_rislife_account_id) then
    raise exception 'RISLIFE_ACCOUNT_HIDDEN';
  end if;
$n1$ in d) = 0 then
    if position($v1$  if not public._corporate_can_configure() then raise exception 'NOT_ALLOWED'; end if;
$v1$ in d) = 0 then raise exception 'ANCORA_FALTANDO: corporate_settings_save (1)'; end if;
    d := replace(d, $v1$  if not public._corporate_can_configure() then raise exception 'NOT_ALLOWED'; end if;
$v1$, $n1$  if not public._corporate_can_configure() then raise exception 'NOT_ALLOWED'; end if;
  -- 4025: a conta da RisLife só aparece para quem a cadastrou; quem não a enxerga não configura.
  if public._gateway_account_hidden((select c.rislife_account_id from public.corporate_gateway_settings c where c.id))
     or public._gateway_account_hidden(p_rislife_account_id) then
    raise exception 'RISLIFE_ACCOUNT_HIDDEN';
  end if;
$n1$);
  end if;
  if d <> orig then execute d; end if;
end;
$do$;

do $do$
declare d text := pg_get_functiondef('public.gateway_surveys_read(uuid)'::regprocedure); orig text;
begin
  orig := d;
  if position($n1$  if not (public.is_admin_master() or public.is_finance_franchisor()) then raise exception 'NOT_ALLOWED'; end if;
  if public._gateway_account_hidden(p_account_id) then return '[]'::jsonb; end if;
  return coalesce($n1$ in d) = 0 then
    if position($v1$  if not (public.is_admin_master() or public.is_finance_franchisor()) then raise exception 'NOT_ALLOWED'; end if;
  return coalesce($v1$ in d) = 0 then raise exception 'ANCORA_FALTANDO: gateway_surveys_read (1)'; end if;
    d := replace(d, $v1$  if not (public.is_admin_master() or public.is_finance_franchisor()) then raise exception 'NOT_ALLOWED'; end if;
  return coalesce($v1$, $n1$  if not (public.is_admin_master() or public.is_finance_franchisor()) then raise exception 'NOT_ALLOWED'; end if;
  if public._gateway_account_hidden(p_account_id) then return '[]'::jsonb; end if;
  return coalesce($n1$);
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
  (select count(*) from public.gateway_accounts where visible_only_to is not null) as contas_restritas,
  (select count(*) from pg_policies where schemaname = 'public'
      and ((tablename = 'gateway_accounts' and qual ilike '%visible_only_to%')
        or (tablename in ('audit_changes', 'audit_logs') and qual ilike '%_gateway_account_hidden%'))) as regras_com_a_trava,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('central_history', 'gateway_split_read', 'gateway_split_save',
          'corporate_settings_read', 'corporate_settings_save', 'gateway_surveys_read')
      and position('_gateway_account_hidden' in p.prosrc) > 0) as funcoes_com_a_trava,
  (select applied from public.gateway_asaas_migrations() where code = '4025') as na_lista;
