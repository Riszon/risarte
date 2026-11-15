-- =============================================================================
-- 4014 — ASA4, entrega 2 (parte 2): CARTÃO PARCELADO PELO ASAAS — devolução por
-- Pix, contestação com prazo, link vencido e o split na aprovação (spec 19.20 e
-- 19.23; plano aprovado pelo Jeferson em 14/11/2026, com ressalvas)
-- -----------------------------------------------------------------------------
-- DEVOLUÇÃO POR PIX (1a, até a entrega 6): a desistência no meio do tratamento.
--   O parcelamento continua pago e a taxa da rede continua devida. O Gerente (ou
--   o Financeiro da Franqueadora / Admin Master) PEDE, com o valor, o motivo e o
--   DISTRATO ou TERMO DE DEVOLUÇÃO ASSINADO anexado (sem o anexo, não registra);
--   só o Financeiro da Franqueadora ou o Admin Master AUTORIZAM. Autorizada, vira
--   conta a pagar da unidade (1.9.03, Cancelamentos e estornos), paga pelo Pix da
--   conta da unidade no fluxo de sempre das contas a pagar (com o comprovante).
-- CONTESTAÇÃO (ajuste E): o prazo para mandar documentos vem do Asaas
--   (`GET /payments/{id}/chargeback` → `deadlineToSendDisputeDocuments`, lido pelo
--   servidor); o aviso vai para o Gerente, quem fechou a venda, o Financeiro da
--   Franqueadora e o Admin Master — quando chega e 2 dias úteis antes do prazo.
-- LINK VENCIDO (3a): o parcelamento não pago depois do 1º vencimento avisa quem
--   fechou a venda e o Gerente no dia útil seguinte e de 7 em 7 dias. Sem
--   cancelamento automático: o Gerente decide.
-- O SPLIT NA APROVAÇÃO (3a): o servidor confere a tarifa do dia da aprovação e,
--   se o split foi calculado com outra, troca o split do parcelamento inteiro
--   (`PUT /installments/{id}/splits`). A lista e a marca ficam aqui.
-- Nenhum dado é apagado. Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) A DEVOLUÇÃO POR PIX
-- -----------------------------------------------------------------------------
create table if not exists public.card_block_returns (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  installment_block uuid not null,
  client_id uuid references public.clients (id),
  amount_cents bigint not null check (amount_cents > 0),
  reason text not null check (length(btrim(reason)) >= 5),
  term_path text not null,
  term_name text,
  status text not null default 'pedida' check (status in ('pedida', 'autorizada', 'negada')),
  requested_by uuid references public.profiles (id),
  requested_at timestamptz not null default now(),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  decision_note text,
  payable_id uuid references public.payables (id)
);
create index if not exists card_block_returns_block_idx on public.card_block_returns (installment_block);
alter table public.card_block_returns enable row level security;
drop policy if exists card_block_returns_select on public.card_block_returns;
create policy card_block_returns_select on public.card_block_returns for select to authenticated
  using (public.can_manage_payables(clinic_id) or public.is_finance_franchisor() or public.is_admin_master());
comment on table public.card_block_returns is
  'ASA4 (4014): devolução por Pix ao paciente na desistência do cartão parcelado pelo Asaas, com o termo assinado e a autorização do Financeiro da Franqueadora ou do Admin Master.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('devolucoes', 'devolucoes', false, 10485760,
        array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- VER e ENVIAR = quem cuida das contas a pagar da unidade (e o Financeiro e o
-- Admin); APAGAR = ninguém (o termo é prova).
drop policy if exists "devolucoes_select" on storage.objects;
create policy "devolucoes_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'devolucoes'
    and public.clinic_of_storage_path(name) is not null
    and (public.can_manage_payables(public.clinic_of_storage_path(name)) or public.is_finance_franchisor() or public.is_admin_master())
  );
drop policy if exists "devolucoes_insert" on storage.objects;
create policy "devolucoes_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'devolucoes'
    and public.clinic_of_storage_path(name) is not null
    and (public.can_manage_payables(public.clinic_of_storage_path(name)) or public.is_finance_franchisor() or public.is_admin_master())
  );

create or replace function public._card_block_return_can_request(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin_master() or public.is_finance_franchisor()
      or public.has_role_in_clinic(p_clinic_id, array['unit_manager']::public.user_role[]);
$$;
revoke execute on function public._card_block_return_can_request(uuid) from public, anon, authenticated;

-- O PEDIDO: o parcelamento pago, o valor até o que ainda não foi devolvido, o
-- motivo e o termo assinado (anexo obrigatório, na pasta da unidade).
create or replace function public.card_block_return_request(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_block uuid := (p ->> 'block')::uuid;
  v_amount bigint := (p ->> 'amount_cents')::bigint;
  v_reason text := btrim(coalesce(p ->> 'reason', ''));
  v_path text := nullif(btrim(p ->> 'term_path'), '');
  v_clinic uuid;
  v_client uuid;
  v_paid bigint;
  v_already bigint;
  v_id uuid;
  v_user uuid := (select auth.uid());
begin
  select min(c.clinic_id::text)::uuid, min(c.client_id::text)::uuid, sum(c.paid_cents)
    into v_clinic, v_client, v_paid
    from public.charges c where c.installment_block = v_block;
  if v_clinic is null then raise exception 'CHARGE_NOT_FOUND'; end if;
  if not public._card_block_return_can_request(v_clinic) then raise exception 'NOT_ALLOWED'; end if;
  if exists (select 1 from public.charges c where c.installment_block = v_block
              and (c.status not in ('paga', 'liquidada') or c.refund_state is not null)) then
    raise exception 'PARCELADO_ASAAS_NAO_PAGO';
  end if;
  if length(v_reason) < 5 then raise exception 'REASON_REQUIRED'; end if;
  if v_path is null or public.clinic_of_storage_path(v_path) is distinct from v_clinic
     or not exists (select 1 from storage.objects o where o.bucket_id = 'devolucoes' and o.name = v_path) then
    raise exception 'TERM_REQUIRED';
  end if;
  select coalesce(sum(r.amount_cents), 0) into v_already
    from public.card_block_returns r where r.installment_block = v_block and r.status <> 'negada';
  if coalesce(v_amount, 0) <= 0 or v_amount > coalesce(v_paid, 0) - v_already then
    raise exception 'AMOUNT_OVER_BALANCE';
  end if;
  insert into public.card_block_returns (clinic_id, installment_block, client_id, amount_cents, reason, term_path, term_name, requested_by)
  values (v_clinic, v_block, v_client, v_amount, v_reason, v_path, nullif(btrim(p ->> 'term_name'), ''), v_user)
  returning id into v_id;
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_clinic, 'create', 'card_block_return', v_id::text,
          jsonb_build_object('block', v_block, 'amount_cents', v_amount, 'reason', v_reason));
  perform public._notify_users('devolucao_pedida', v_id::text, public._admins_and_finance(), v_clinic,
    'Devolução por Pix para autorizar',
    'Pedido de devolução ao paciente de ' || public.brl(v_amount) || ' num cartão parcelado pelo Asaas (desistência). Confira o termo assinado e autorize ou negue.',
    '/prontuarios/' || v_client::text);
  return v_id;
end;
$$;
revoke execute on function public.card_block_return_request(jsonb) from public, anon, authenticated;
grant execute on function public.card_block_return_request(jsonb) to authenticated;

-- A DECISÃO: só o Financeiro da Franqueadora ou o Admin Master. Autorizada, vira
-- conta a pagar da unidade (1.9.03), para pagar pelo Pix da conta da unidade.
create or replace function public.card_block_return_decide(p_id uuid, p_approve boolean, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.card_block_returns%rowtype;
  v_user uuid := (select auth.uid());
  v_payable uuid;
  v_nome text;
begin
  if not (public.is_admin_master() or public.is_finance_franchisor()) then raise exception 'NOT_ALLOWED'; end if;
  select * into r from public.card_block_returns where id = p_id for update;
  if not found then raise exception 'RETURN_NOT_FOUND'; end if;
  if r.status <> 'pedida' then raise exception 'RETURN_ALREADY_DECIDED'; end if;
  if not p_approve and length(btrim(coalesce(p_note, ''))) < 5 then raise exception 'REASON_REQUIRED'; end if;
  if p_approve then
    select full_name into v_nome from public.clients where id = r.client_id;
    insert into public.payables (clinic_id, account_code, description, reference, accrual_date, due_date,
                                 amount_cents, status, notes, created_by)
    values (r.clinic_id, '1.9.03',
            'Devolução ao paciente — desistência no cartão parcelado pelo Asaas' || coalesce(' — ' || v_nome, ''),
            'DEV-' || left(r.id::text, 8), public.today_br(), public.today_br() + 5,
            r.amount_cents, 'aberta',
            'Pagar por Pix da conta da unidade e anexar o comprovante. O parcelamento no cartão continua pago e a taxa da rede continua devida. Termo assinado: ' || r.term_path,
            v_user)
    returning id into v_payable;
  end if;
  update public.card_block_returns
     set status = case when p_approve then 'autorizada' else 'negada' end,
         decided_by = v_user, decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), ''),
         payable_id = v_payable
   where id = p_id;
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, r.clinic_id, 'update', 'card_block_return', p_id::text,
          jsonb_build_object('approve', p_approve, 'note', p_note, 'payable_id', v_payable));
  perform public._notify_users('devolucao_decidida', p_id::text, array[r.requested_by], r.clinic_id,
    case when p_approve then 'Devolução por Pix autorizada' else 'Devolução por Pix negada' end,
    case when p_approve then 'A devolução virou conta a pagar da unidade (Contas a pagar). Pague pelo Pix da conta da unidade e anexe o comprovante.'
         else 'A devolução foi negada: ' || coalesce(p_note, '') end,
    '/prontuarios/' || r.client_id::text);
  return v_payable;
end;
$$;
revoke execute on function public.card_block_return_decide(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.card_block_return_decide(uuid, boolean, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 2) A CONTESTAÇÃO COM PRAZO
-- -----------------------------------------------------------------------------
alter table public.charges add column if not exists chargeback_deadline date;
alter table public.charges add column if not exists chargeback_status text;
alter table public.charges add column if not exists chargeback_checked_at timestamptz;

-- O servidor lê no Asaas (só ele chama o Asaas) as contestações sem prazo conhecido.
create or replace function public._chargebacks_to_check(p_limit integer)
returns table (charge_id uuid, account_id uuid, asaas_payment_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.gateway_account_id, c.asaas_payment_id
    from public.charges c
   where c.status = 'em_contestacao' and c.asaas_payment_id is not null and c.gateway_account_id is not null
     and (c.chargeback_checked_at is null or (c.chargeback_deadline is null and c.chargeback_checked_at < now() - interval '6 hours'))
   order by c.last_event_at nulls last
   limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;
revoke execute on function public._chargebacks_to_check(integer) from public, anon, authenticated;

create or replace function public._chargeback_save(p_charge_id uuid, p_deadline date, p_status text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.charges
     set chargeback_deadline = coalesce(p_deadline, chargeback_deadline),
         chargeback_status = coalesce(nullif(p_status, ''), chargeback_status),
         chargeback_checked_at = now()
   where id = p_charge_id;
$$;
revoke execute on function public._chargeback_save(uuid, date, text) from public, anon, authenticated;

-- Os avisos: quando chega (com o prazo, se já conhecido) e 2 dias úteis antes do prazo.
create or replace function public.chargeback_alerts_run()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hoje date := public.today_br();
  v_n integer := 0;
  r record;
  v_users uuid[];
  v_chave text;
  v_prazo text;
begin
  for r in
    select c.id, c.clinic_id, c.client_id, c.installment_block, c.chargeback_deadline, i.negotiation_id, i.direct_sale_id
      from public.charges c join public.payment_installments i on i.id = c.payment_installment_id
     where c.status = 'em_contestacao'
  loop
    select coalesce(array_agg(u.user_id), '{}') into v_users from public.user_clinic_roles u
     where u.clinic_id = r.clinic_id and u.role = 'unit_manager';
    v_users := v_users || public._admins_and_finance() || array[public._sale_closer(r.negotiation_id, r.direct_sale_id)];
    -- No parcelamento, um aviso para o bloco (não um por parcela).
    v_chave := coalesce(r.installment_block, r.id)::text;
    v_prazo := case when r.chargeback_deadline is null then 'O prazo para mandar os documentos ainda vai ser lido do Asaas.'
                    else 'Prazo para mandar os documentos ao Asaas: ' || to_char(r.chargeback_deadline, 'DD/MM/YYYY') || '.' end;
    v_n := v_n + public._notify_users('contestacao_recebida', v_chave, v_users, r.clinic_id,
      'Contestação no cartão pelo titular',
      'O titular do cartão contestou a compra. As parcelas ficam "em contestação" (a baixa continua). ' || v_prazo ||
      ' A defesa é feita no painel do Asaas, com os documentos da venda.',
      '/prontuarios/' || r.client_id::text);
    if r.chargeback_deadline is not null and v_hoje < r.chargeback_deadline
       and public._payout_add_business_days(v_hoje, 2) >= r.chargeback_deadline then
      v_n := v_n + public._notify_users('contestacao_prazo', v_chave || ':' || r.chargeback_deadline::text, v_users, r.clinic_id,
        'Contestação: o prazo dos documentos está acabando',
        'Faltam 2 dias úteis ou menos para mandar ao Asaas os documentos da contestação (prazo ' || to_char(r.chargeback_deadline, 'DD/MM/YYYY') || ').',
        '/prontuarios/' || r.client_id::text);
    end if;
  end loop;
  return v_n;
end;
$$;
revoke execute on function public.chargeback_alerts_run() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3) O LINK VENCIDO SEM PAGAMENTO, DE 7 EM 7 DIAS (3a)
-- -----------------------------------------------------------------------------
create or replace function public.card_block_overdue_alerts_run()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hoje date := public.today_br();
  v_n integer := 0;
  r record;
  v_users uuid[];
  v_ciclo integer;
begin
  for r in
    select c.installment_block, min(c.clinic_id::text)::uuid clinic_id, min(c.client_id::text)::uuid client_id,
           min(c.due_date) primeiro, min(i.negotiation_id::text)::uuid negotiation_id, min(i.direct_sale_id::text)::uuid direct_sale_id,
           count(*) n, sum(c.value_cents) total
      from public.charges c join public.payment_installments i on i.id = c.payment_installment_id
     where c.installment_block is not null
     group by c.installment_block
    having bool_and(c.status in ('emitida', 'vencida')) and min(c.due_date) < v_hoje
  loop
    -- O 1º aviso no dia útil seguinte ao 1º vencimento; depois, de 7 em 7 dias.
    if public._payout_add_business_days(r.primeiro, 1) > v_hoje then continue; end if;
    v_ciclo := (v_hoje - public._payout_add_business_days(r.primeiro, 1)) / 7;
    select coalesce(array_agg(u.user_id), '{}') into v_users from public.user_clinic_roles u
     where u.clinic_id = r.clinic_id and u.role = 'unit_manager';
    v_users := v_users || array[public._sale_closer(r.negotiation_id, r.direct_sale_id)];
    v_n := v_n + public._notify_users('parcelado_vencido', r.installment_block::text || ':' || v_ciclo, v_users, r.clinic_id,
      'Cartão parcelado vencido sem pagamento',
      'O parcelamento no cartão pelo Asaas (' || r.n || 'x, ' || public.brl(r.total::bigint) || ') venceu em ' ||
      to_char(r.primeiro, 'DD/MM/YYYY') || ' e não foi pago. O link continua valendo: reenvie ao paciente, ou o Gerente cancela ou troca o meio. Este aviso se repete a cada 7 dias.',
      '/prontuarios/' || r.client_id::text);
  end loop;
  return v_n;
end;
$$;
revoke execute on function public.card_block_overdue_alerts_run() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4) O SPLIT NA APROVAÇÃO: a tarifa do dia da aprovação em todas as parcelas
-- -----------------------------------------------------------------------------
alter table public.charges add column if not exists split_checked_at timestamptz;

-- Os parcelamentos aprovados com split ainda não conferido pela tarifa do dia.
create or replace function public._card_blocks_split_to_check(p_limit integer)
returns table (installment_block uuid, account_id uuid, asaas_installment_id text, paid_on date, charge_ids uuid[])
language sql
stable
security definer
set search_path = ''
as $$
  select c.installment_block, min(c.gateway_account_id::text)::uuid, min(c.asaas_installment_id), min(c.paid_on),
         array_agg(c.id order by c.installment_number)
    from public.charges c
   where c.installment_block is not null and c.split_applied and c.asaas_installment_id is not null
   group by c.installment_block
  having bool_and(c.status = 'paga') and bool_and(c.split_checked_at is null)
     and bool_and(c.refund_state is null)
     -- só enquanto nenhuma parcela tem o split liquidado (depois disso o Asaas não muda)
     and not exists (select 1 from public.charge_splits cs where cs.charge_id = any (array_agg(c.id)) and cs.status <> 'enviado')
   limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;
revoke execute on function public._card_blocks_split_to_check(integer) from public, anon, authenticated;

create or replace function public._card_block_split_checked(p_block uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.charges set split_checked_at = now() where installment_block = p_block;
$$;
revoke execute on function public._card_block_split_checked(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5) AS COBRANÇAS DA VENDA mostram a devolução e a contestação
-- -----------------------------------------------------------------------------
create or replace function public._card_block_summary(p_negotiation_id uuid, p_direct_sale_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_n integer;
  v_total bigint;
  v_block uuid;
  v_clinic uuid;
  v jsonb;
begin
  select count(*), sum(i.amount_cents), min(i.clinic_id::text)::uuid into v_n, v_total, v_clinic
    from public._card_block_rows(p_negotiation_id, p_direct_sale_id) i;
  if coalesce(v_n, 0) = 0 then return null; end if;
  select c.installment_block into v_block
    from public.charges c
    join public._card_block_rows(p_negotiation_id, p_direct_sale_id) i on i.id = c.payment_installment_id
   where c.installment_block is not null
   order by (c.status = 'cancelada'), c.created_at desc limit 1;
  select jsonb_build_object(
    'block', v_block,
    'parcelas', v_n,
    'total', v_total,
    'situacao', case
       when v_block is null then 'sem_parcelamento'
       when bool_or(c.status = 'em_contestacao') then 'em_contestacao'
       when bool_or(c.refund_state is not null) then 'estorno_pedido'
       when bool_and(c.status = 'estornada') then 'estornado'
       when bool_and(c.status = 'cancelada') then 'cancelado'
       when bool_and(c.status in ('paga', 'liquidada')) then 'pago'
       when bool_or(c.status = 'erro_emissao') then 'erro'
       when bool_or(c.status = 'emitindo') then 'emitindo'
       when bool_or(c.status = 'vencida') then 'vencido'
       else 'aguardando' end,
    'link', (array_agg(c.invoice_url order by c.installment_number) filter (where c.invoice_url is not null))[1],
    'primeira', (array_agg(c.id order by c.installment_number))[1],
    'creditadas', count(*) filter (where c.status = 'liquidada'),
    'pode_gerar', v_block is null or bool_and(c.status = 'cancelada'),
    'pode_tentar_de_novo', v_block is not null and bool_or(c.status = 'erro_emissao')
                           and bool_and(c.status in ('erro_emissao', 'emitindo', 'emitida')),
    'pode_cancelar', v_block is not null and bool_and(c.status in ('emitindo', 'emitida', 'vencida', 'erro_emissao')),
    'pode_estornar', v_block is not null and bool_and(c.status in ('paga', 'liquidada')) and bool_and(c.refund_state is null),
    'gerar_permitido', public._charge_can('emit', v_clinic),
    'cancelar_permitido', public._charge_can('cancel', v_clinic),
    'estornar_permitido', public._charge_refund_can(v_clinic),
    -- 4014: a contestação (com o prazo) e a devolução por Pix.
    'clinic', v_clinic,
    'contestacao_prazo', min(c.chargeback_deadline),
    'pago_cents', coalesce(sum(c.paid_cents) filter (where c.status in ('paga', 'liquidada')), 0),
    'pode_pedir_devolucao', v_block is not null and bool_and(c.status in ('paga', 'liquidada')) and bool_and(c.refund_state is null)
                            and public._card_block_return_can_request(v_clinic),
    'pode_decidir_devolucao', public.is_admin_master() or public.is_finance_franchisor(),
    'devolucoes', (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', r.id, 'valor', r.amount_cents, 'motivo', r.reason, 'situacao', r.status,
                     'termo', r.term_path, 'termo_nome', r.term_name, 'pedida_em', r.requested_at,
                     'quem_pediu', (select full_name from public.profiles where id = r.requested_by),
                     'decidida_em', r.decided_at, 'nota', r.decision_note, 'conta_a_pagar', r.payable_id)
                     order by r.requested_at), '[]'::jsonb)
                     from public.card_block_returns r where r.installment_block = v_block))
    into v
    from (select 1) x
    left join public.charges c on c.installment_block = v_block;
  return v;
end;
$$;
revoke execute on function public._card_block_summary(uuid, uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6) AUDITORIA E CONFERÊNCIA
-- -----------------------------------------------------------------------------
select public.audit_attach_all();

select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'card_block_return_request', 'card_block_return_decide', '_card_block_return_can_request',
      '_chargebacks_to_check', '_chargeback_save', 'chargeback_alerts_run', 'card_block_overdue_alerts_run',
      '_card_blocks_split_to_check', '_card_block_split_checked')) as funcoes_novas,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'charges'
    and column_name in ('chargeback_deadline', 'chargeback_status', 'chargeback_checked_at', 'split_checked_at')) as colunas_novas,
  (select not public from storage.buckets where id = 'devolucoes') as pasta_privada,
  (select count(*) from public.card_block_returns) as devolucoes;
