-- =============================================================================
-- 0199 — FIN4b.2: abrangência da adquirente, taxa do boleto na emissão e
--                 edição de faixa de taxa
-- -----------------------------------------------------------------------------
-- Três buracos que o teste do dono encontrou na 0197/0198:
--
--   1) ADQUIRENTE ERA SEMPRE DA UNIDADE. Quando a FRANQUEADORA negocia uma
--      tabela com o Asaas para a rede inteira, era preciso recadastrar a mesma
--      coisa em cada unidade — e cada erro de digitação vira número errado no
--      caixa daquela unidade. Agora a adquirente tem ABRANGÊNCIA:
--      só esta unidade / toda a rede / unidades específicas.
--
--   2) TAXA DE BOLETO SÓ EXISTIA NO RECEBIMENTO. A maioria dos bancos cobra o
--      boleto na EMISSÃO — pago ou não. Do jeito antigo, boleto emitido e não
--      pago ficava com custo zero no resultado, o que é mentira.
--
--   3) FAIXA DE TAXA SÓ PODIA SER EXCLUÍDA. Excluir uma faixa que já precificou
--      recebimentos apaga a explicação de números que já foram para o razão.
--
-- TRAVA DE DUPLA COBRANÇA (preocupação do dono, e é a parte que mais importa):
-- uma parcela nunca paga a taxa duas vezes.
--   • register_boleto_issue() recusa se a configuração da adquirente disser
--     que a taxa é cobrada no pagamento (FEE_NOT_ON_ISSUE);
--   • recusa se a parcela já teve taxa cobrada numa baixa;
--   • apply_acquirer_fee() (a baixa) NÃO cobra quando a faixa diz "emissão" —
--     só grava a data de liquidação e registra o porquê;
--   • o razão tem índice único em (source_type, source_id): com a origem
--     'boleto_issue' apontando para a PARCELA, o segundo lançamento é
--     impossível, venha do botão ou do futuro webhook do Asaas.
--
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) ABRANGÊNCIA da adquirente
-- -----------------------------------------------------------------------------
alter table public.card_acquirers
  alter column clinic_id drop not null,
  add column if not exists scope text not null default 'unidade';

alter table public.card_acquirers
  drop constraint if exists card_acquirers_scope_check;
alter table public.card_acquirers
  add constraint card_acquirers_scope_check
  check (scope in ('unidade', 'rede', 'unidades'));

-- Coerência: cadastro de unidade tem dono; cadastro da rede não tem.
alter table public.card_acquirers
  drop constraint if exists card_acquirers_scope_clinic_check;
alter table public.card_acquirers
  add constraint card_acquirers_scope_clinic_check
  check (
    (scope = 'unidade' and clinic_id is not null)
    or (scope in ('rede', 'unidades') and clinic_id is null)
  );

comment on column public.card_acquirers.scope is
  'unidade = cadastro da própria unidade; rede = vale para todas (inclusive as '
  'que ainda vão existir); unidades = vale para as listadas em '
  'card_acquirer_clinics. Rede e unidades só a Franqueadora cadastra.';

-- As unidades atendidas quando a abrangência é "unidades específicas".
create table if not exists public.card_acquirer_clinics (
  acquirer_id uuid not null references public.card_acquirers (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  primary key (acquirer_id, clinic_id)
);

create index if not exists card_acquirer_clinics_clinic_idx
  on public.card_acquirer_clinics (clinic_id);

-- Uma padrão por unidade — e uma padrão da rede.
-- (O índice antigo, só em (clinic_id), deixaria passar VÁRIAS padrões da rede:
--  em índice único, NULL é sempre distinto de NULL.)
drop index if exists public.card_acquirers_default_unique;
create unique index if not exists card_acquirers_default_unique
  on public.card_acquirers (clinic_id)
  where is_default and clinic_id is not null;
create unique index if not exists card_acquirers_network_default_unique
  on public.card_acquirers ((clinic_id is null))
  where is_default and clinic_id is null;

-- -----------------------------------------------------------------------------
-- 2) Quem a adquirente atende, quem enxerga e quem edita
-- -----------------------------------------------------------------------------

-- A adquirente vale para esta unidade?
create or replace function public.acquirer_applies_to(
  p_acquirer_id uuid,
  p_clinic_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.card_acquirers a
    where a.id = p_acquirer_id
      and (
        a.clinic_id = p_clinic_id
        or a.scope = 'rede'
        or (a.scope = 'unidades' and exists (
              select 1 from public.card_acquirer_clinics l
              where l.acquirer_id = a.id and l.clinic_id = p_clinic_id))
      )
  );
$$;

grant execute on function public.acquirer_applies_to(uuid, uuid) to authenticated;

-- SECURITY DEFINER de propósito: usada DENTRO das policies. Consultar a tabela
-- de vínculo direto na policy criaria recursão de RLS (lição do CLAUDE.md).
create or replace function public.acquirer_visible_to_me(p_acquirer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.card_acquirers a
    where a.id = p_acquirer_id
      and (
        a.clinic_id in (select public.finance_visible_clinic_ids())
        or (a.scope = 'rede'
            and exists (select 1 from public.finance_visible_clinic_ids()))
        or exists (
             select 1 from public.card_acquirer_clinics l
             where l.acquirer_id = a.id
               and l.clinic_id in (select public.finance_visible_clinic_ids()))
      )
  );
$$;

grant execute on function public.acquirer_visible_to_me(uuid) to authenticated;

-- Cadastro da rede é ato da FRANQUEADORA: a unidade não reescreve a taxa que a
-- rede negociou (senão a tabela vira colcha de retalhos).
create or replace function public.can_manage_acquirer(p_acquirer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.card_acquirers a
    where a.id = p_acquirer_id
      and case
            when a.clinic_id is not null then public.can_reconcile(a.clinic_id)
            else public.is_admin_master() or public.is_finance_franchisor()
          end
  );
$$;

grant execute on function public.can_manage_acquirer(uuid) to authenticated;

drop policy if exists "card_acquirers_select" on public.card_acquirers;
create policy "card_acquirers_select" on public.card_acquirers
  for select to authenticated
  using (public.acquirer_visible_to_me(id));

drop policy if exists "card_acquirers_write" on public.card_acquirers;
create policy "card_acquirers_write" on public.card_acquirers
  for all to authenticated
  using (
    case when clinic_id is not null then public.can_reconcile(clinic_id)
         else public.is_admin_master() or public.is_finance_franchisor() end
  )
  with check (
    case when clinic_id is not null then public.can_reconcile(clinic_id)
         else public.is_admin_master() or public.is_finance_franchisor() end
  );

alter table public.card_acquirer_clinics enable row level security;

drop policy if exists "card_acquirer_clinics_select" on public.card_acquirer_clinics;
create policy "card_acquirer_clinics_select" on public.card_acquirer_clinics
  for select to authenticated
  using (public.acquirer_visible_to_me(acquirer_id));

drop policy if exists "card_acquirer_clinics_write" on public.card_acquirer_clinics;
create policy "card_acquirer_clinics_write" on public.card_acquirer_clinics
  for all to authenticated
  using (public.can_manage_acquirer(acquirer_id))
  with check (public.can_manage_acquirer(acquirer_id));

-- As taxas seguem a adquirente.
drop policy if exists "acquirer_rates_select" on public.acquirer_rates;
create policy "acquirer_rates_select" on public.acquirer_rates
  for select to authenticated
  using (public.acquirer_visible_to_me(acquirer_id));

drop policy if exists "acquirer_rates_write" on public.acquirer_rates;
create policy "acquirer_rates_write" on public.acquirer_rates
  for all to authenticated
  using (public.can_manage_acquirer(acquirer_id))
  with check (public.can_manage_acquirer(acquirer_id));

-- -----------------------------------------------------------------------------
-- 3) QUANDO a taxa é cobrada (a correção do dono)
-- -----------------------------------------------------------------------------
alter table public.acquirer_rates
  add column if not exists fee_charged_on text not null default 'pagamento';

alter table public.acquirer_rates
  drop constraint if exists acquirer_rates_charged_on_check;
alter table public.acquirer_rates
  add constraint acquirer_rates_charged_on_check
  check (fee_charged_on in ('pagamento', 'emissao'));

comment on column public.acquirer_rates.fee_charged_on is
  'pagamento = a taxa sai do que entra na baixa (não pagou, não custou). '
  'emissao = o custo nasce quando o boleto é gerado, PAGO OU NÃO — e nesse '
  'caso a baixa NUNCA cobra de novo.';

drop function if exists public.acquirer_rate_for(uuid, text, integer, date);

create or replace function public.acquirer_rate_for(
  p_acquirer_id uuid,
  p_modality text,
  p_installments integer,
  p_date date default current_date
)
returns table (
  fee_percent numeric,
  fixed_fee_cents bigint,
  settlement_days integer,
  settlement_business_days boolean,
  free_monthly_count integer,
  fee_charged_on text
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.fee_percent, r.fixed_fee_cents, r.settlement_days,
         r.settlement_business_days, r.free_monthly_count, r.fee_charged_on
  from public.acquirer_rates r
  where r.acquirer_id = p_acquirer_id
    and r.modality = p_modality
    and coalesce(p_installments, 1) between r.min_installments and r.max_installments
    and r.valid_from <= coalesce(p_date, current_date)
    and (r.valid_to is null or r.valid_to >= coalesce(p_date, current_date))
  order by r.valid_from desc
  limit 1;
$$;

grant execute on function public.acquirer_rate_for(uuid, text, integer, date)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 4) A EMISSÃO do boleto
-- -----------------------------------------------------------------------------
alter table public.payment_installments
  add column if not exists boleto_issued_at date,
  add column if not exists boleto_fee_cents bigint not null default 0,
  add column if not exists boleto_acquirer_id uuid
    references public.card_acquirers (id);

comment on column public.payment_installments.boleto_issued_at is
  'Quando o boleto foi gerado. Marca a cobrança da taxa de emissão — e é a '
  'trava que impede a baixa cobrar a mesma taxa de novo.';

alter table public.payment_receipts
  add column if not exists acquirer_fee_charged_at_issue boolean not null
    default false;

comment on column public.payment_receipts.acquirer_fee_charged_at_issue is
  'A taxa desta cobrança já foi paga na EMISSÃO do boleto. A baixa não cobra '
  'de novo — só registra a data de liquidação.';

-- O razão aceita a origem nova.
drop index if exists public.financial_entries_source_unique;
create unique index if not exists financial_entries_source_unique
  on public.financial_entries (source_type, source_id)
  where source_type in ('installment_accrual', 'receipt_cash',
                        'receipt_benefit', 'receipt_late_fee',
                        'renegotiation_charges', 'renegotiation_benefit',
                        'renegotiation_discount', 'renegotiation_surcharge',
                        'payable_accrual', 'payable_cash', 'payable_late_fee',
                        'acquirer_fee', 'boleto_issue');

-- Registra que o boleto foi gerado e lança a taxa de emissão.
--
-- Quando o ASAAS entrar, o webhook de "boleto gerado" chama ESTA função — não
-- uma nova. Por isso as travas ficam aqui dentro, e não na tela.
create or replace function public.register_boleto_issue(
  p_installment_id uuid,
  p_acquirer_id uuid default null,
  p_issued_at date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inst record;
  v_acc record;
  v_rate record;
  v_acquirer uuid;
  v_percent_fee bigint;
  v_fixed bigint;
  v_fee bigint;
  v_used integer;
  v_waived boolean := false;
begin
  select * into v_inst from public.payment_installments where id = p_installment_id;
  if v_inst.id is null then raise exception 'INSTALLMENT_NOT_FOUND'; end if;
  if not public.can_receive_payment(v_inst.clinic_id) then
    raise exception 'NOT_ALLOWED';
  end if;

  -- Trava 1: uma emissão por parcela (o clique repetido e o webhook do Asaas
  -- caem os dois aqui).
  if v_inst.boleto_issued_at is not null then
    raise exception 'ALREADY_ISSUED';
  end if;

  -- Trava 2: se a baixa já cobrou a taxa desta parcela, a emissão não cobra.
  if exists (
    select 1 from public.payment_receipts r
    where r.installment_id = p_installment_id
      and r.acquirer_fee_cents > 0
      and not r.reversed and r.reversal_of is null
  ) then
    raise exception 'FEE_ALREADY_CHARGED';
  end if;

  v_acquirer := coalesce(p_acquirer_id, v_inst.acquirer_id);
  if v_acquirer is null then
    select a.id into v_acquirer
    from public.card_acquirers a
    where a.active and public.acquirer_applies_to(a.id, v_inst.clinic_id)
    order by (a.clinic_id is not null) desc, a.is_default desc, a.name
    limit 1;
  end if;
  if v_acquirer is null then raise exception 'ACQUIRER_NOT_FOUND'; end if;

  select * into v_acc from public.card_acquirers where id = v_acquirer;
  if not public.acquirer_applies_to(v_acquirer, v_inst.clinic_id) then
    raise exception 'CLINIC_MISMATCH';
  end if;

  select * into v_rate
  from public.acquirer_rate_for(v_acquirer, 'boleto', 1, p_issued_at);
  if v_rate.fee_percent is null then raise exception 'RATE_NOT_FOUND'; end if;

  -- Trava 3, a que o dono pediu: só cobra na emissão se a CONFIGURAÇÃO da
  -- adquirente disser que é na emissão.
  if v_rate.fee_charged_on <> 'emissao' then
    raise exception 'FEE_NOT_ON_ISSUE';
  end if;

  -- Franquia gratuita do mês conta POR UNIDADE: a fatura da adquirente chega
  -- por conta/CNPJ, e somar a rede tiraria a franquia de quem tem direito.
  if v_rate.free_monthly_count is not null then
    select count(*)::integer into v_used
    from public.payment_installments i
    where i.boleto_acquirer_id = v_acquirer
      and i.clinic_id = v_inst.clinic_id
      and i.boleto_issued_at is not null
      and date_trunc('month', i.boleto_issued_at)
          = date_trunc('month', p_issued_at);
    if v_used < v_rate.free_monthly_count then v_waived := true; end if;
  end if;

  -- Base = valor de face da cobrança (é sobre ele que o banco cobra na hora de
  -- gerar o documento; multa e juros ainda nem existem).
  v_percent_fee := round(v_inst.amount_cents * v_rate.fee_percent / 100.0);
  v_fixed := case when v_waived then 0 else coalesce(v_rate.fixed_fee_cents, 0) end;
  v_fee := v_percent_fee + v_fixed;

  update public.payment_installments set
    boleto_issued_at = p_issued_at,
    boleto_fee_cents = v_fee,
    boleto_acquirer_id = v_acquirer
  where id = p_installment_id;

  -- Despesa da UNIDADE (2.4.01), como toda taxa de adquirente. Competência e
  -- caixa na emissão: o custo é irreversível a partir daqui.
  if v_fee > 0 then
    insert into public.financial_entries (
      clinic_id, account_code, accrual_date, cash_date,
      expected_settlement_date, amount_cents, direction, status,
      source_type, source_id, description, created_by
    ) values (
      v_inst.clinic_id, '2.4.01', p_issued_at, p_issued_at, p_issued_at,
      v_fee, 'outflow', 'settled', 'boleto_issue', p_installment_id,
      'Emissão de boleto — ' || v_acc.name, (select auth.uid())
    )
    on conflict (source_type, source_id) where source_type in
      ('installment_accrual', 'receipt_cash', 'receipt_benefit',
       'receipt_late_fee', 'renegotiation_charges', 'renegotiation_benefit',
       'renegotiation_discount', 'renegotiation_surcharge',
       'payable_accrual', 'payable_cash', 'payable_late_fee',
       'acquirer_fee', 'boleto_issue') do nothing;
  end if;

  return jsonb_build_object(
    'fee_cents', v_fee,
    'waived', v_waived,
    'issued_at', p_issued_at,
    'acquirer', v_acc.name);
end;
$$;

grant execute on function public.register_boleto_issue(uuid, uuid, date)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 5) A BAIXA deixa de cobrar quando a taxa é da emissão
-- -----------------------------------------------------------------------------
create or replace function public.apply_acquirer_fee(
  p_receipt_id uuid,
  p_acquirer_id uuid,
  p_modality text,
  p_installments integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rec record;
  v_inst record;
  v_acc record;
  v_rate record;
  v_percent_fee bigint := 0;
  v_fixed bigint := 0;
  v_fee bigint := 0;
  v_settle date;
  v_used integer;
  v_waived boolean := false;
  v_at_issue boolean := false;
begin
  select * into v_rec from public.payment_receipts where id = p_receipt_id;
  if v_rec.id is null then raise exception 'RECEIPT_NOT_FOUND'; end if;
  if not public.can_receive_payment(v_rec.clinic_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if v_rec.acquirer_id is not null then raise exception 'FEE_ALREADY_APPLIED'; end if;

  select * into v_acc from public.card_acquirers where id = p_acquirer_id;
  if v_acc.id is null then raise exception 'ACQUIRER_NOT_FOUND'; end if;
  -- 0199: a adquirente pode ser da rede — o que vale é se ela ATENDE a unidade.
  if not public.acquirer_applies_to(p_acquirer_id, v_rec.clinic_id) then
    raise exception 'CLINIC_MISMATCH';
  end if;

  select * into v_rate
  from public.acquirer_rate_for(
    p_acquirer_id, p_modality, p_installments, v_rec.received_at);
  if v_rate.fee_percent is null then raise exception 'RATE_NOT_FOUND'; end if;

  select * into v_inst
  from public.payment_installments where id = v_rec.installment_id;

  -- TRAVA DE DUPLA COBRANÇA. Duas portas para o mesmo destino:
  --   • a parcela já teve o boleto emitido (a taxa saiu lá); ou
  --   • a faixa diz que a cobrança é na emissão — então a baixa nunca cobra,
  --     mesmo que a emissão não tenha sido registrada. Deixar de lançar um
  --     custo é erro menor que lançar duas vezes o mesmo custo.
  v_at_issue := (v_inst.id is not null and v_inst.boleto_issued_at is not null)
                or v_rate.fee_charged_on = 'emissao';

  if not v_at_issue then
    if v_rate.free_monthly_count is not null then
      select count(*)::integer into v_used
      from public.payment_receipts r
      where r.acquirer_id = p_acquirer_id
        and r.acquirer_modality = p_modality
        and r.clinic_id = v_rec.clinic_id
        and not r.reversed and r.reversal_of is null
        and date_trunc('month', r.received_at)
            = date_trunc('month', v_rec.received_at);
      if v_used < v_rate.free_monthly_count then v_waived := true; end if;
    end if;

    v_percent_fee := round(v_rec.amount_cents * v_rate.fee_percent / 100.0);
    v_fixed := case when v_waived then 0 else coalesce(v_rate.fixed_fee_cents, 0) end;
    v_fee := v_percent_fee + v_fixed;
  end if;

  v_settle := case
    when v_rate.settlement_business_days
      then public.add_business_days(v_rec.received_at,
                                    coalesce(v_rate.settlement_days, 0))
    else v_rec.received_at + coalesce(v_rate.settlement_days, 0)
  end;

  update public.payment_receipts set
    acquirer_id = p_acquirer_id,
    acquirer_modality = p_modality,
    acquirer_fee_cents = v_fee,
    acquirer_fixed_fee_cents = v_fixed,
    acquirer_fee_percent = v_rate.fee_percent,
    acquirer_fee_waived = v_waived,
    acquirer_fee_charged_at_issue = v_at_issue,
    settlement_date = v_settle
  where id = p_receipt_id;

  if v_fee > 0 then
    insert into public.financial_entries (
      clinic_id, account_code, accrual_date, cash_date,
      expected_settlement_date, amount_cents, direction, status,
      source_type, source_id, description, created_by
    ) values (
      v_rec.clinic_id, '2.4.01', v_rec.received_at, v_settle, v_settle,
      v_fee, 'outflow', 'settled', 'acquirer_fee', p_receipt_id,
      'Taxa de ' || v_acc.name || ' — ' || p_modality, (select auth.uid())
    )
    on conflict (source_type, source_id) where source_type in
      ('installment_accrual', 'receipt_cash', 'receipt_benefit',
       'receipt_late_fee', 'renegotiation_charges', 'renegotiation_benefit',
       'renegotiation_discount', 'renegotiation_surcharge',
       'payable_accrual', 'payable_cash', 'payable_late_fee',
       'acquirer_fee', 'boleto_issue') do nothing;
  end if;

  update public.financial_entries
     set cash_date = v_settle, expected_settlement_date = v_settle
   where source_type = 'receipt_cash' and source_id = p_receipt_id;

  return jsonb_build_object(
    'fee_cents', v_fee,
    'percent_fee_cents', v_percent_fee,
    'fixed_fee_cents', v_fixed,
    'fee_percent', v_rate.fee_percent,
    'waived', v_waived,
    'charged_at_issue', v_at_issue,
    'settlement_date', v_settle,
    'net_cents', v_rec.amount_cents - v_fee);
end;
$$;

grant execute on function public.apply_acquirer_fee(uuid, uuid, text, integer)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 6) A projeção passa a enxergar a adquirente da rede
-- -----------------------------------------------------------------------------
create or replace function public.apply_settlement_projection(
  p_negotiation_id uuid,
  p_direct_sale_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_method text;
  v_installments integer;
  v_modality text;
  v_acquirer uuid;
  v_rate record;
begin
  if p_negotiation_id is not null then
    select n.clinic_id, n.payment_method, n.installments
      into v_clinic, v_method, v_installments
    from public.plan_negotiations n where n.id = p_negotiation_id;
  else
    select s.clinic_id, s.payment_method, s.installments
      into v_clinic, v_method, v_installments
    from public.direct_sales s where s.id = p_direct_sale_id;
  end if;
  if v_clinic is null then return; end if;

  v_modality := public.card_modality_of(v_method, v_installments);

  if v_modality is null then
    update public.payment_installments
       set expected_settlement_date = due_date, acquirer_id = null
     where (p_negotiation_id is not null and negotiation_id = p_negotiation_id)
        or (p_direct_sale_id is not null and direct_sale_id = p_direct_sale_id);
    return;
  end if;

  -- Ordem de escolha: padrão da própria unidade → outra da unidade → padrão da
  -- rede → qualquer uma que atenda. O cadastro próprio da unidade ganha da rede
  -- porque quem tem contrato próprio é quem paga a taxa dele.
  select a.id into v_acquirer
  from public.card_acquirers a
  where a.active and public.acquirer_applies_to(a.id, v_clinic)
  order by (a.clinic_id is not null) desc, a.is_default desc, a.name
  limit 1;

  if v_acquirer is null then
    update public.payment_installments
       set expected_settlement_date = due_date
     where (p_negotiation_id is not null and negotiation_id = p_negotiation_id)
        or (p_direct_sale_id is not null and direct_sale_id = p_direct_sale_id);
    return;
  end if;

  select * into v_rate
  from public.acquirer_rate_for(v_acquirer, v_modality, v_installments, current_date);

  if v_rate.settlement_days is null then
    update public.payment_installments
       set acquirer_id = v_acquirer, expected_settlement_date = due_date
     where (p_negotiation_id is not null and negotiation_id = p_negotiation_id)
        or (p_direct_sale_id is not null and direct_sale_id = p_direct_sale_id);
    return;
  end if;

  update public.payment_installments
     set acquirer_id = v_acquirer,
         expected_settlement_date = case
           when v_rate.settlement_business_days
             then public.add_business_days(due_date, v_rate.settlement_days)
           else due_date + v_rate.settlement_days
         end
   where (p_negotiation_id is not null and negotiation_id = p_negotiation_id)
      or (p_direct_sale_id is not null and direct_sale_id = p_direct_sale_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- 7) Faixa de taxa: editar sim, apagar histórico não
-- -----------------------------------------------------------------------------

-- Quantos recebimentos e emissões esta faixa já precificou.
--
-- A conta é conservadora de propósito: o recebimento não guarda o número de
-- parcelas, então duas faixas da mesma modalidade (2 a 6 × 7 a 12) contam o
-- mesmo recebimento. Erra para o lado de proteger o histórico — no máximo
-- obriga a ENCERRAR a faixa em vez de apagá-la, que é o caminho certo mesmo.
create or replace function public.acquirer_rate_usage(p_rate_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select (
    select count(*) from public.acquirer_rates r
    join public.payment_receipts p
      on p.acquirer_id = r.acquirer_id
     and p.acquirer_modality = r.modality
     and p.received_at >= r.valid_from
     and (r.valid_to is null or p.received_at <= r.valid_to)
    where r.id = p_rate_id and not p.reversed and p.reversal_of is null
  ) + (
    select count(*) from public.acquirer_rates r
    join public.payment_installments i
      on i.boleto_acquirer_id = r.acquirer_id
     and r.modality = 'boleto'
     and i.boleto_issued_at >= r.valid_from
     and (r.valid_to is null or i.boleto_issued_at <= r.valid_to)
    where r.id = p_rate_id
  );
$$;

grant execute on function public.acquirer_rate_usage(uuid) to authenticated;

-- Uma chamada só para a tela inteira (evita uma consulta por faixa).
create or replace function public.acquirer_rates_usage(p_acquirer_ids uuid[])
returns table (rate_id uuid, uses bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, public.acquirer_rate_usage(r.id)
  from public.acquirer_rates r
  where r.acquirer_id = any (coalesce(p_acquirer_ids, array[]::uuid[]));
$$;

grant execute on function public.acquirer_rates_usage(uuid[]) to authenticated;

-- A barreira de verdade: faixa já usada não é apagada. O caminho certo é
-- ENCERRAR A VIGÊNCIA e cadastrar a nova — assim o que já foi recebido
-- continua explicado pela taxa que valia na época.
create or replace function public.block_used_rate_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.acquirer_rate_usage(old.id) > 0 then
    raise exception 'RATE_IN_USE';
  end if;
  return old;
end;
$$;

drop trigger if exists acquirer_rates_block_delete on public.acquirer_rates;
create trigger acquirer_rates_block_delete
  before delete on public.acquirer_rates
  for each row execute function public.block_used_rate_delete();

-- -----------------------------------------------------------------------------
-- 8) Reparo: cobranças em aberto reavaliadas com o modelo novo
-- -----------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select distinct negotiation_id, direct_sale_id
    from public.payment_installments
    where status in ('em_aberto', 'parcial')
  loop
    perform public.apply_settlement_projection(r.negotiation_id, r.direct_sale_id);
  end loop;
end $$;

select
  (select count(*) from public.card_acquirers) as adquirentes,
  (select count(*) from public.card_acquirers where clinic_id is null) as da_rede,
  (select count(*) from public.acquirer_rates
    where fee_charged_on = 'emissao') as faixas_cobradas_na_emissao,
  (select count(*) from public.payment_installments
    where boleto_issued_at is not null) as boletos_emitidos;
