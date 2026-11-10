-- =============================================================================
-- 1041 — PROPOSTA TRAVADA DEPOIS DA ASSINATURA E O 1º PAGAMENTO NO FINANCEIRO
--         (pedido do dono, 09/11/2026)
--
-- Pedido: *"quando é feito a assinatura de um contrato no empresarial, não pode
-- ser possível alterar a proposta. se for necessário fazer alguma alteração
-- deve ter algum recurso para fazer alterações de proposta e contrato. não tem
-- integração entre o 'pagamento' no funil e o financeiro da empresa. No funil
-- deve ser registrado o primeiro pagamento ou implantação."*
--
-- DECISÕES DO DONO (09/11/2026):
--   • destravar = Admin e gestor do programa (`is_program_manager`), com motivo;
--     o contrato volta a precisar de assinatura;
--   • empresa já criada: ao reassinar, o que mudou vai para o cadastro dela
--     (botão "Levar as alterações para a empresa"; a cópia é do app);
--   • o consultor registra o 1º pagamento no funil (data, valor, forma).
--
-- O QUE ESTAVA ERRADO (medido no treino em 09/11/2026):
--   • nada travava a proposta: com o contrato assinado, qualquer aba salvava;
--   • "Boleto da implantação pago" era uma caixinha: duas empresas do treino
--     têm a caixinha marcada e NENHUMA cobrança. A produção tem zero casos.
--
-- ⚠️ A IMPLANTAÇÃO CONTINUA FORA DO RAZÃO (decisão da 1040: é 100% da
-- RisLife). Aqui ela nasce na aba de cobranças da empresa, já paga.
--
-- O que muda:
--   1) colunas do pagamento no lead e a origem da cobrança (`origin_lead_id`);
--   2) a trava: gatilho nas 7 tabelas da proposta recusa PROPOSAL_LOCKED
--      enquanto o lead tiver `contract_signed_at`;
--   3) o selo do contrato só se desfaz pela porta `reopen_lead_proposal`
--      (registro em `lead_proposal_reopenings`); o pagamento já lançado no
--      financeiro não se desfaz pelo funil (estorno é do Financeiro);
--   4) `settle_billing` vira porta sobre `_settle_billing_raw` (a conta da
--      baixa mora na crua — mudar lá);
--   5) `post_lead_implantation`: cria a cobrança de Implantação JÁ PAGA a
--      partir do registro do funil (uma por lead; repetir devolve a mesma).
--
-- Idempotente. Nada é apagado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) O pagamento no lead e a origem da cobrança
-- -----------------------------------------------------------------------------
alter table empresarial.commercial_leads
  add column if not exists implantation_paid_cents bigint,
  add column if not exists implantation_payment_method text,
  add column if not exists implantation_paid_by uuid references public.profiles (id) on delete set null;

alter table empresarial.commercial_leads
  drop constraint if exists commercial_leads_implantation_paid_cents_check;
alter table empresarial.commercial_leads
  add constraint commercial_leads_implantation_paid_cents_check
  check (implantation_paid_cents is null or implantation_paid_cents > 0);

alter table empresarial.commercial_leads
  drop constraint if exists commercial_leads_implantation_payment_method_check;
alter table empresarial.commercial_leads
  add constraint commercial_leads_implantation_payment_method_check
  check (implantation_payment_method is null
         or implantation_payment_method in ('BOLETO','PIX','CARD','TRANSFER','CASH'));

comment on column empresarial.commercial_leads.implantation_paid_cents is
  '1041: valor do 1º pagamento (implantação) registrado no funil. Nulo nos '
  'selos antigos (caixinha), que não diziam o valor.';

alter table empresarial.adhesion_billing
  add column if not exists origin_lead_id uuid
    references empresarial.commercial_leads (id) on delete set null;

comment on column empresarial.adhesion_billing.origin_lead_id is
  '1041: a implantação que nasceu do pagamento registrado no funil.';

-- Uma implantação viva por lead: repetir o lançamento não cobra duas vezes.
create unique index if not exists adhesion_billing_implantacao_do_lead
  on empresarial.adhesion_billing (origin_lead_id)
  where origin_lead_id is not null
    and billing_type = 'IMPLANTATION'
    and status <> 'CANCELLED';

-- -----------------------------------------------------------------------------
-- 2) A trava da proposta
-- -----------------------------------------------------------------------------
create or replace function empresarial.guard_lead_proposal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_lead uuid;
begin
  -- Apagar o lead leva a proposta junto (cascata): não é edição.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;

  if tg_op = 'DELETE' then
    v_lead := old.lead_id;
  else
    v_lead := new.lead_id;
  end if;
  -- Os modelos da REDE (proposta/contrato com lead nulo) não são de lead.
  if v_lead is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if exists (
    select 1 from empresarial.commercial_leads l
     where l.id = v_lead and l.contract_signed_at is not null
  ) then
    raise exception 'PROPOSAL_LOCKED'
      using hint = 'O contrato desta empresa já foi assinado. Para alterar a '
                   'proposta, use "Alterar proposta e contrato" (Admin ou '
                   'gestor do programa).';
  end if;

  if tg_op = 'UPDATE' and old.lead_id is distinct from new.lead_id
     and exists (
       select 1 from empresarial.commercial_leads l
        where l.id = old.lead_id and l.contract_signed_at is not null
     )
  then
    raise exception 'PROPOSAL_LOCKED';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$fn$;
revoke execute on function empresarial.guard_lead_proposal() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array[
    'lead_qualification', 'lead_price_tiers', 'lead_benefits', 'lead_perks',
    'lead_clinics', 'proposal_templates', 'contract_templates'
  ] loop
    execute format('drop trigger if exists %I on empresarial.%I', t || '_proposta_travada', t);
    execute format(
      'create trigger %I before insert or update or delete on empresarial.%I '
      'for each row execute function empresarial.guard_lead_proposal()',
      t || '_proposta_travada', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 3) Destravar: só pela porta, com motivo e registro
-- -----------------------------------------------------------------------------
create table if not exists empresarial.lead_proposal_reopenings (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references empresarial.commercial_leads (id) on delete cascade,
  reason text not null check (length(btrim(reason)) >= 10),
  previous_signed_at timestamptz not null,
  reopened_by uuid references public.profiles (id) on delete set null,
  reopened_at timestamptz not null default now(),
  applied_to_company_at timestamptz,
  applied_by uuid references public.profiles (id) on delete set null
);
create index if not exists lead_proposal_reopenings_lead_idx
  on empresarial.lead_proposal_reopenings (lead_id, reopened_at desc);

alter table empresarial.lead_proposal_reopenings enable row level security;
drop policy if exists lead_proposal_reopenings_select on empresarial.lead_proposal_reopenings;
create policy lead_proposal_reopenings_select on empresarial.lead_proposal_reopenings
  for select to authenticated
  using (empresarial.can_access_lead(lead_id));
-- Sem regra de escrita: grava só pelas portas abaixo.
grant select on empresarial.lead_proposal_reopenings to authenticated;
grant all on empresarial.lead_proposal_reopenings to service_role;

create or replace function empresarial.guard_lead_signatures()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  -- O contrato assinado só se desfaz pela porta (motivo e registro).
  if old.contract_signed_at is not null
     and new.contract_signed_at is null
     and coalesce(current_setting('empresarial.reabrindo_proposta', true), '') <> 'on'
  then
    raise exception 'CONTRACT_SIGNED_LOCKED'
      using hint = 'Para desfazer a assinatura, use "Alterar proposta e '
                   'contrato" (Admin ou gestor do programa).';
  end if;

  -- O 1º pagamento já lançado no financeiro não muda pelo funil.
  if (old.implantation_paid_at is distinct from new.implantation_paid_at
      or old.implantation_paid_cents is distinct from new.implantation_paid_cents
      or old.implantation_payment_method is distinct from new.implantation_payment_method)
     and exists (
       select 1 from empresarial.adhesion_billing b
        where b.origin_lead_id = old.id
          and b.billing_type = 'IMPLANTATION'
          and b.status <> 'CANCELLED'
     )
  then
    raise exception 'IMPLANTATION_IN_FINANCE'
      using hint = 'O pagamento já está nas cobranças da empresa. Para '
                   'desfazer, o Financeiro estorna a cobrança lá.';
  end if;
  return new;
end;
$fn$;
revoke execute on function empresarial.guard_lead_signatures() from public, anon, authenticated;

drop trigger if exists commercial_leads_guard_signatures on empresarial.commercial_leads;
create trigger commercial_leads_guard_signatures
  before update on empresarial.commercial_leads
  for each row execute function empresarial.guard_lead_signatures();

create or replace function empresarial.reopen_lead_proposal(p_lead_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_lead record;
  v_id uuid;
  v_motivo text := btrim(coalesce(p_reason, ''));
begin
  if auth.uid() is null or not empresarial.is_program_manager() then
    raise exception 'NOT_ALLOWED';
  end if;
  if length(v_motivo) < 10 then
    raise exception 'REASON_REQUIRED';
  end if;

  select id, contract_signed_at into v_lead
    from empresarial.commercial_leads where id = p_lead_id for update;
  if not found then raise exception 'LEAD_NOT_FOUND'; end if;
  if v_lead.contract_signed_at is null then raise exception 'NOT_SIGNED'; end if;

  insert into empresarial.lead_proposal_reopenings
    (lead_id, reason, previous_signed_at, reopened_by)
  values (p_lead_id, v_motivo, v_lead.contract_signed_at, auth.uid())
  returning id into v_id;

  perform set_config('empresarial.reabrindo_proposta', 'on', true);
  update empresarial.commercial_leads
     set contract_signed_at = null
   where id = p_lead_id;
  perform set_config('empresarial.reabrindo_proposta', 'off', true);

  insert into empresarial.commercial_lead_activities (lead_id, author_id, kind, note)
  values (p_lead_id, auth.uid(), 'NOTE',
          'Proposta e contrato destravados para alteração. Motivo: ' || v_motivo
          || '. O contrato precisa ser assinado de novo.');
  return v_id;
end;
$fn$;
revoke execute on function empresarial.reopen_lead_proposal(uuid, text) from public, anon, authenticated;
grant execute on function empresarial.reopen_lead_proposal(uuid, text) to authenticated;

-- Depois de reassinar, o app leva as alterações à empresa e marca aqui.
create or replace function empresarial.mark_reopening_applied(p_reopening_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v record;
begin
  if auth.uid() is null or not empresarial.is_program_manager() then
    raise exception 'NOT_ALLOWED';
  end if;
  select r.id, r.lead_id, r.reopened_at, r.applied_to_company_at,
         l.contract_signed_at, l.company_id
    into v
    from empresarial.lead_proposal_reopenings r
    join empresarial.commercial_leads l on l.id = r.lead_id
   where r.id = p_reopening_id
   for update of r;
  if not found then raise exception 'REOPENING_NOT_FOUND'; end if;
  if v.applied_to_company_at is not null then return; end if;
  if v.company_id is null then raise exception 'NO_COMPANY'; end if;
  if v.contract_signed_at is null or v.contract_signed_at < v.reopened_at then
    raise exception 'NOT_SIGNED_AGAIN';
  end if;

  update empresarial.lead_proposal_reopenings
     set applied_to_company_at = now(), applied_by = auth.uid()
   where id = p_reopening_id;
  insert into empresarial.commercial_lead_activities (lead_id, author_id, kind, note)
  values (v.lead_id, auth.uid(), 'NOTE',
          'Alterações da proposta reassinada levadas para o cadastro da empresa.');
end;
$fn$;
revoke execute on function empresarial.mark_reopening_applied(uuid) from public, anon, authenticated;
grant execute on function empresarial.mark_reopening_applied(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 4) settle_billing vira PORTA sobre _settle_billing_raw
-- -----------------------------------------------------------------------------
create or replace function empresarial._settle_billing_raw(
  p_billing_id uuid, p_paid_at timestamp with time zone)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_bill record;
  v_rules record;
  v_risarte_pct numeric(5,2);
  v_risarte bigint;
begin
  select * into v_bill from empresarial.adhesion_billing where id = p_billing_id;
  if not found then raise exception 'BILLING_NOT_FOUND'; end if;
  if v_bill.status = 'PAID' then return; end if;

  select * into v_rules
  from empresarial.split_rules
  where company_id = v_bill.company_id or company_id is null
  order by (company_id = v_bill.company_id) desc
  limit 1;

  v_risarte_pct := case
    when v_bill.billing_type = 'IMPLANTATION'
      then coalesce(v_rules.first_payment_risarte_pct, 0)
    else coalesce(v_rules.recurring_risarte_pct, 50)
  end;
  v_risarte := round(v_bill.total_amount_cents * v_risarte_pct / 100.0);

  update empresarial.adhesion_billing
    set status = 'PAID',
        paid_at = p_paid_at,
        split_risarte_cents = v_risarte,
        split_rislife_cents = v_bill.total_amount_cents - v_risarte
  where id = p_billing_id;

  -- Pagou: se não há mais atraso, a empresa volta a ficar ativa.
  perform empresarial.refresh_company_suspension(v_bill.company_id);
end $function$;
revoke execute on function empresarial._settle_billing_raw(uuid, timestamp with time zone) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION empresarial.settle_billing(p_billing_id uuid, p_paid_at timestamp with time zone DEFAULT now())
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- AP16: só o gestor do programa (ou o Admin) dá baixa. Sem usuário (webhook
  -- do ASAAS, rotina) passa: quem chega sem login pela API já não executa.
  -- 1041: a conta da baixa mora em `_settle_billing_raw`.
  if auth.uid() is not null
     and not (public.is_admin_master() or empresarial.is_program_finance()) then
    raise exception 'NOT_ALLOWED';
  end if;
  perform empresarial._settle_billing_raw(p_billing_id, p_paid_at);
end $function$;
revoke execute on function empresarial.settle_billing(uuid, timestamp with time zone) from public, anon, authenticated;
grant execute on function empresarial.settle_billing(uuid, timestamp with time zone) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5) O pagamento do funil vira a cobrança de Implantação paga
-- -----------------------------------------------------------------------------
create or replace function empresarial.post_lead_implantation(p_lead_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_lead record;
  v_company record;
  v_doc uuid;
  v_id uuid;
  v_dia date;
  v_forma text;
begin
  if auth.uid() is not null
     and not (public.is_admin_master() or empresarial.can_access_lead(p_lead_id)) then
    raise exception 'NOT_ALLOWED';
  end if;

  select id, company_id, implantation_paid_at, implantation_paid_cents,
         implantation_payment_method
    into v_lead
    from empresarial.commercial_leads where id = p_lead_id for update;
  if not found then raise exception 'LEAD_NOT_FOUND'; end if;
  if v_lead.company_id is null then raise exception 'NO_COMPANY'; end if;
  if v_lead.implantation_paid_at is null or coalesce(v_lead.implantation_paid_cents, 0) <= 0 then
    raise exception 'NO_PAYMENT';
  end if;

  select id into v_id
    from empresarial.adhesion_billing
   where origin_lead_id = p_lead_id
     and billing_type = 'IMPLANTATION'
     and status <> 'CANCELLED'
   limit 1;
  if v_id is not null then return v_id; end if;

  select id, contracted_holders into v_company
    from empresarial.companies where id = v_lead.company_id;
  select id into v_doc
    from empresarial.company_documents
   where company_id = v_lead.company_id and is_primary
   limit 1;

  v_dia := (v_lead.implantation_paid_at at time zone 'America/Sao_Paulo')::date;
  v_forma := case v_lead.implantation_payment_method
    when 'BOLETO' then 'boleto'
    when 'PIX' then 'Pix'
    when 'CARD' then 'cartão'
    when 'TRANSFER' then 'transferência'
    when 'CASH' then 'dinheiro'
    else null end;

  insert into empresarial.adhesion_billing
    (company_id, company_document_id, billing_type, reference_month,
     total_amount_cents, status, due_date, description, holders_covered,
     origin_lead_id)
  values
    (v_lead.company_id, v_doc, 'IMPLANTATION', date_trunc('month', v_dia)::date,
     v_lead.implantation_paid_cents, 'PENDING', v_dia,
     'Implantação (1º pagamento) — registrada no funil'
       || coalesce(' · ' || v_forma, ''),
     v_company.contracted_holders, p_lead_id)
  returning id into v_id;

  perform empresarial._settle_billing_raw(v_id, v_lead.implantation_paid_at);

  insert into empresarial.commercial_lead_activities (lead_id, author_id, kind, note)
  values (p_lead_id, auth.uid(), 'NOTE',
          '1º pagamento (implantação) lançado nas cobranças da empresa, já pago.');
  return v_id;
end;
$fn$;
revoke execute on function empresarial.post_lead_implantation(uuid) from public, anon, authenticated;
grant execute on function empresarial.post_lead_implantation(uuid) to authenticated, service_role;

select public.audit_attach_all();

notify pgrst, 'reload schema';

-- Conferência (só leitura): esperado 3 · 7 · 1 · true · true · true
select
  (select count(*) from information_schema.columns
    where table_schema = 'empresarial' and table_name = 'commercial_leads'
      and column_name in ('implantation_paid_cents','implantation_payment_method','implantation_paid_by')) as colunas_do_pagamento,
  (select count(*) from pg_trigger where tgname like '%\_proposta\_travada') as travas,
  (select count(*) from pg_trigger where tgname = 'commercial_leads_guard_signatures') as guarda_dos_selos,
  not has_function_privilege('anon', 'empresarial.reopen_lead_proposal(uuid,text)', 'execute') as destravar_sem_login_fechado,
  not has_function_privilege('anon', 'empresarial.post_lead_implantation(uuid)', 'execute') as lancar_sem_login_fechado,
  not has_function_privilege('authenticated', 'empresarial._settle_billing_raw(uuid,timestamp with time zone)', 'execute') as baixa_crua_fechada;
