-- =============================================================================
-- 0374 — A PROPOSTA DE PAGAMENTO MORA NA NEGOCIAÇÃO (AP130 + AP131)
-- -----------------------------------------------------------------------------
-- Continuação da 0373 (CBE-00001, Cambé). O "Salvar negociação" criava as
-- cobranças de verdade (`payment_installments`) com a negociação ainda aberta.
-- A 0373 tirou a RECEITA delas e a ficha do cliente as escondeu, mas elas
-- continuavam contando em 12 lugares: Recebíveis, inadimplentes, relatório,
-- Fluxo de caixa previsto, Painel da unidade e da rede, Recebíveis da rede,
-- alerta diário de atraso, conferência do Fechamento e Metas.
--
-- Decisão do dono (10/11/2026): a proposta fica NA NEGOCIAÇÃO e a cobrança
-- nasce no "Cliente aceitou" (AP131). A receita continua esperando o contrato
-- assinado (0373) — "plano aprovado é quando o cliente assinou o contrato".
--
-- O QUE MUDA:
--   1. `plan_negotiations.proposed_schedule` (jsonb) guarda o parcelamento
--      proposto: [{kind, due_date, amount_cents, payment_method}].
--   2. `save_payment_schedule` (venda por negociação): com a negociação ABERTA
--      grava só a proposta — nenhuma cobrança nasce. Com ela ACEITA (ou a venda
--      fechada) faz o de sempre: reescreve as cobranças.
--   3. A negociação vira "aceita" → as cobranças nascem da proposta (gatilho;
--      vale para qualquer caminho do aceite). Soma diferente do valor final
--      RECUSA o aceite (`SCHEDULE_TOTAL_MISMATCH`): salve a negociação de novo.
--   4. A negociação aceita volta a "em negociação" (renegociar depois do
--      aceite) → as cobranças sem dinheiro voltam a ser proposta. Com dinheiro
--      recebido, ficam (o salvar recusa, `SCHEDULE_LOCKED`, como antes).
--   Venda direta e renegociação NÃO mudam.
--
-- ACERTO DOS DADOS (seção 6, DESTRUTIVO declarado, com o OK do dono): as
-- cobranças "em aberto" de negociação NÃO aceita e venda NÃO fechada, sem
-- nenhum dinheiro na negociação, viram a proposta dela e saem da tabela de
-- cobranças. A receita delas já estava cancelada (0373); o gatilho da 0373
-- garante. A trilha de alterações (0288) guarda cada linha apagada.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) A proposta, na negociação
-- -----------------------------------------------------------------------------
alter table public.plan_negotiations
  add column if not exists proposed_schedule jsonb;

comment on column public.plan_negotiations.proposed_schedule is
  '0374: parcelamento PROPOSTO [{kind, due_date, amount_cents, payment_method}]. '
  'Vira cobrança (payment_installments) no aceite; antes disso não é cobrança.';

-- -----------------------------------------------------------------------------
-- 2) A venda desta negociação já fechou? (contrato assinado + pagamento)
-- -----------------------------------------------------------------------------
create or replace function public._negotiation_sale_closed(p_negotiation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.commercial_sales cs
     where cs.negotiation_id = p_negotiation_id and cs.closed_at is not null);
$$;
revoke execute on function public._negotiation_sale_closed(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3) Da proposta para as cobranças (no aceite)
-- -----------------------------------------------------------------------------
create or replace function public._materialize_negotiation_schedule(p_negotiation_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_neg public.plan_negotiations;
  v_sum integer;
  v_seq int := 0;
  v_e jsonb;
begin
  select * into v_neg from public.plan_negotiations where id = p_negotiation_id;
  if v_neg.id is null then return 0; end if;

  -- Já tem cobrança de verdade (venda antiga, ou reescrita depois do aceite):
  -- não duplica.
  if exists (select 1 from public.payment_installments i
              where i.negotiation_id = p_negotiation_id and i.status <> 'cancelada') then
    return 0;
  end if;
  if v_neg.proposed_schedule is null
     or jsonb_array_length(v_neg.proposed_schedule) = 0 then
    return 0;
  end if;

  select coalesce(sum((e->>'amount_cents')::int), 0) into v_sum
    from jsonb_array_elements(v_neg.proposed_schedule) e;
  if v_sum <> coalesce(v_neg.final_cents, 0) then
    raise exception 'SCHEDULE_TOTAL_MISMATCH';
  end if;

  for v_e in select * from jsonb_array_elements(v_neg.proposed_schedule)
  loop
    v_seq := v_seq + 1;
    insert into public.payment_installments
      (clinic_id, client_id, negotiation_id, direct_sale_id, seq, kind,
       due_date, amount_cents, payment_method, created_by)
    values (
      v_neg.clinic_id, v_neg.client_id, p_negotiation_id, null, v_seq,
      coalesce(v_e->>'kind', 'parcela'),
      (v_e->>'due_date')::date,
      (v_e->>'amount_cents')::int,
      coalesce(nullif(v_e->>'payment_method', ''), v_neg.payment_method),
      (select auth.uid())
    );
  end loop;

  perform public.apply_sale_benefit_risk(p_negotiation_id, null);
  perform public.apply_settlement_projection(p_negotiation_id, null);
  return v_seq;
end;
$$;
revoke execute on function public._materialize_negotiation_schedule(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4) Das cobranças de volta para a proposta (renegociar depois do aceite)
-- -----------------------------------------------------------------------------
create or replace function public._schedule_back_to_proposal(p_negotiation_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  if public._negotiation_sale_closed(p_negotiation_id) then return 0; end if;
  -- Dinheiro na negociação: nada volta (o salvar recusa, SCHEDULE_LOCKED).
  if exists (
    select 1 from public.payment_installments i
     where i.negotiation_id = p_negotiation_id
       and (i.status in ('paga', 'parcial', 'renegociada')
            or coalesce(i.paid_amount_cents, 0) > 0
            or exists (select 1 from public.payment_receipts r where r.installment_id = i.id))
  ) then
    return 0;
  end if;

  update public.plan_negotiations n
     set proposed_schedule = (
           select jsonb_agg(jsonb_build_object(
                    'kind', i.kind, 'due_date', i.due_date,
                    'amount_cents', i.amount_cents, 'payment_method', i.payment_method)
                  order by i.seq)
             from public.payment_installments i
            where i.negotiation_id = p_negotiation_id and i.status = 'em_aberto')
   where n.id = p_negotiation_id
     and exists (select 1 from public.payment_installments i
                  where i.negotiation_id = p_negotiation_id and i.status = 'em_aberto');

  delete from public.payment_installments
   where negotiation_id = p_negotiation_id and status = 'em_aberto';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function public._schedule_back_to_proposal(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5) O gatilho da situação da negociação
-- -----------------------------------------------------------------------------
create or replace function public.negotiation_schedule_on_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'aceita' and old.status is distinct from 'aceita' then
    perform public._materialize_negotiation_schedule(new.id);
  elsif old.status = 'aceita'
        and new.status in ('em_negociacao', 'aguardando_autorizacao') then
    perform public._schedule_back_to_proposal(new.id);
  end if;
  return null;
end;
$$;
revoke execute on function public.negotiation_schedule_on_status() from public, anon, authenticated;

drop trigger if exists plan_negotiations_schedule_on_status on public.plan_negotiations;
create trigger plan_negotiations_schedule_on_status
  after update of status on public.plan_negotiations
  for each row
  when (new.status is distinct from old.status)
  execute function public.negotiation_schedule_on_status();

-- -----------------------------------------------------------------------------
-- 6) Salvar o parcelamento: negociação aberta = só a proposta
-- -----------------------------------------------------------------------------
create or replace function public.save_payment_schedule(
  p_negotiation_id uuid,
  p_direct_sale_id uuid,
  p_entries jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_client uuid;
  v_final integer;
  v_method text;
  v_neg_status text;
  v_sum integer;
  v_down integer;
  v_entradas int;
  v_locked int;
  v_user uuid := (select auth.uid());
  v_seq int := 0;
  v_e jsonb;
  v_proposta jsonb;
begin
  if (p_negotiation_id is null) = (p_direct_sale_id is null) then
    raise exception 'ORIGIN_REQUIRED';
  end if;

  if p_negotiation_id is not null then
    select n.clinic_id, n.client_id, n.final_cents, n.payment_method, n.status
      into v_clinic, v_client, v_final, v_method, v_neg_status
    from public.plan_negotiations n where n.id = p_negotiation_id;
  else
    select s.clinic_id, s.client_id, s.final_cents, s.payment_method
      into v_clinic, v_client, v_final, v_method
    from public.direct_sales s where s.id = p_direct_sale_id;
  end if;
  if v_clinic is null then raise exception 'SALE_NOT_FOUND'; end if;

  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(
         v_clinic,
         array['unit_manager','receptionist','sdr']::public.user_role[])
    or exists (
      select 1 from public.providers_with_access(v_clinic, 'commercial_consultant') p
      where p.user_id = v_user)
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  select count(*) into v_locked
  from public.payment_installments i
  where ((p_negotiation_id is not null and i.negotiation_id = p_negotiation_id)
      or (p_direct_sale_id is not null and i.direct_sale_id = p_direct_sale_id))
    and (i.status in ('paga', 'parcial', 'renegociada')
         or coalesce(i.paid_amount_cents, 0) > 0
         or exists (select 1 from public.payment_receipts r
                    where r.installment_id = i.id));
  if v_locked > 0 then raise exception 'SCHEDULE_LOCKED'; end if;

  select coalesce(sum((e->>'amount_cents')::int), 0),
         count(*) filter (where e->>'kind' = 'entrada'),
         coalesce(sum((e->>'amount_cents')::int)
                  filter (where e->>'kind' = 'entrada'), 0)
    into v_sum, v_entradas, v_down
  from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) e;

  if v_entradas > 1 then raise exception 'MULTIPLE_DOWN_PAYMENTS'; end if;
  if v_sum <> coalesce(v_final, 0) then raise exception 'TOTAL_MISMATCH'; end if;

  -- 0374: a proposta, normalizada (o que a tela mandou, na ordem).
  select jsonb_agg(jsonb_build_object(
           'kind', coalesce(e->>'kind', 'parcela'),
           'due_date', (e->>'due_date')::date,
           'amount_cents', (e->>'amount_cents')::int,
           'payment_method', coalesce(nullif(e->>'payment_method', ''), v_method))
         order by ord)
    into v_proposta
  from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) with ordinality as t(e, ord);

  -- 0374: NEGOCIAÇÃO ABERTA = SÓ A PROPOSTA. Nenhuma cobrança nasce antes do
  -- "Cliente aceitou" (AP131); as que existirem (renegociar depois do aceite)
  -- saem — nenhuma tem dinheiro (conferido acima).
  if p_negotiation_id is not null
     and v_neg_status is distinct from 'aceita'
     and not public._negotiation_sale_closed(p_negotiation_id) then
    delete from public.payment_installments
     where negotiation_id = p_negotiation_id and status <> 'cancelada';
    update public.plan_negotiations
       set proposed_schedule = v_proposta,
           down_payment_cents = v_down, updated_at = now()
     where id = p_negotiation_id;
    return;
  end if;

  delete from public.payment_installments
   where (p_negotiation_id is not null and negotiation_id = p_negotiation_id)
      or (p_direct_sale_id is not null and direct_sale_id = p_direct_sale_id);

  for v_e in select * from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb))
  loop
    v_seq := v_seq + 1;
    insert into public.payment_installments
      (clinic_id, client_id, negotiation_id, direct_sale_id, seq, kind,
       due_date, amount_cents, payment_method, created_by)
    values (
      v_clinic, v_client, p_negotiation_id, p_direct_sale_id, v_seq,
      coalesce(v_e->>'kind', 'parcela'),
      (v_e->>'due_date')::date,
      (v_e->>'amount_cents')::int,
      -- 0200: sem meio na cobrança, vale o da VENDA.
      coalesce(nullif(v_e->>'payment_method', ''), v_method),
      v_user
    );
  end loop;

  perform public.apply_sale_benefit_risk(p_negotiation_id, p_direct_sale_id);
  perform public.apply_settlement_projection(p_negotiation_id, p_direct_sale_id);

  if p_negotiation_id is not null then
    update public.plan_negotiations
       set down_payment_cents = v_down, proposed_schedule = v_proposta,
           updated_at = now()
     where id = p_negotiation_id;
  else
    update public.direct_sales
       set down_payment_cents = v_down, updated_at = now()
     where id = p_direct_sale_id;
  end if;
end;
$$;

revoke execute on function public.save_payment_schedule(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_payment_schedule(uuid, uuid, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 7) ACERTO DOS DADOS — as cobranças de negociação aberta viram a proposta dela
-- -----------------------------------------------------------------------------
-- Só negociação NÃO aceita, venda NÃO fechada e NENHUM dinheiro na negociação.
-- Guarda a proposta (se ainda não houver) e tira as cobranças "em aberto".
-- DESTRUTIVO: apaga cobranças que eram só proposta (nunca receberam dinheiro; a receita já foi cancelada pela 0373; a trilha 0288 guarda cada linha). Decisão do dono, 10/11/2026 (AP130/AP131).
with alvo as (
  select n.id
    from public.plan_negotiations n
   where n.status <> 'aceita'
     and not public._negotiation_sale_closed(n.id)
     and exists (select 1 from public.payment_installments i
                  where i.negotiation_id = n.id and i.status = 'em_aberto')
     and not exists (
       select 1 from public.payment_installments i
        where i.negotiation_id = n.id
          and (i.status in ('paga', 'parcial', 'renegociada')
               or coalesce(i.paid_amount_cents, 0) > 0
               or exists (select 1 from public.payment_receipts r where r.installment_id = i.id)))
),
guardada as (
  update public.plan_negotiations n
     set proposed_schedule = coalesce(n.proposed_schedule, (
           select jsonb_agg(jsonb_build_object(
                    'kind', i.kind, 'due_date', i.due_date,
                    'amount_cents', i.amount_cents, 'payment_method', i.payment_method)
                  order by i.seq)
             from public.payment_installments i
            where i.negotiation_id = n.id and i.status = 'em_aberto'))
    from alvo
   where n.id = alvo.id
  returning n.id
)
-- DESTRUTIVO: só as cobranças "em aberto" que acabaram de virar a proposta da negociação (ver acima).
delete from public.payment_installments i
 using guardada g
 where i.negotiation_id = g.id and i.status = 'em_aberto';

-- -----------------------------------------------------------------------------
-- Conferência (só contagens — nenhum dado pessoal)
-- -----------------------------------------------------------------------------
select
  (select count(*) from public.payment_installments i
     join public.plan_negotiations n on n.id = i.negotiation_id
    where i.status = 'em_aberto' and n.status <> 'aceita'
      and not public._negotiation_sale_closed(n.id)
      and coalesce(i.paid_amount_cents, 0) = 0)
    as cobranca_de_proposta_esperado_0,
  (select count(*) from public.plan_negotiations where proposed_schedule is not null)
    as negociacoes_com_proposta_guardada,
  (select count(*) from pg_trigger
    where tgname = 'plan_negotiations_schedule_on_status' and not tgisinternal)
    as gatilho_esperado_1,
  has_function_privilege('anon', 'public._materialize_negotiation_schedule(uuid)', 'execute')
    as sem_login_executa_esperado_false;
