-- =============================================================================
-- 0373 — RECEITA SÓ COM A VENDA FECHADA (e parcela apagada leva a receita junto)
-- -----------------------------------------------------------------------------
-- Achado do dono (09/11/2026), cliente CBE-00001 da Risarte Cambé - Centro:
--
--   negociação ............... ABERTA (Follow-up, cliente vai falar com o marido)
--   fechamento ............... NÃO EXISTE (contrato não assinado)
--   cobranças ................ 8 × R$ 496,94, a 1ª já "em atraso" com multa
--   DRE de novembro .......... R$ 7.951,10 = 2 × R$ 3.975,55 (a venda, EM DOBRO)
--
-- DUAS CAUSAS, as duas no banco:
--
-- CAUSA 1 — A RECEITA NASCIA COM A COBRANÇA, NÃO COM A VENDA.
-- O botão "Salvar negociação" grava as cobranças no mesmo clique (J4b) — é o
-- plano de pagamento PROPOSTO. E o gatilho `payment_installments_accrual`
-- (0187) lança a receita de competência (conta 1.1.01/1.1.02) para TODA
-- cobrança que nasce, sem perguntar se a venda fechou. A regra de ouro
-- ("só é venda com contrato assinado") estava protegida para a BAIXA (0203),
-- não para a RECEITA.
--
-- CAUSA 2 — SALVAR DE NOVO DEIXAVA A RECEITA ANTIGA PARA TRÁS.
-- `save_payment_schedule` apaga as cobranças e cria outras. O lançamento do
-- razão não pode ser apagado (0185, `ENTRY_IMMUTABLE_DELETE`) e não tem chave
-- estrangeira para a cobrança — ele ficava "aberto" apontando para uma cobrança
-- que não existe mais. Cada novo "Salvar negociação" somava a venda inteira de
-- novo na DRE. Duas vezes salvo = receita em dobro.
--
-- O QUE MUDA:
--   1. A receita de uma cobrança de VENDA só é lançada quando a venda FECHA
--      (`commercial_sales.closed_at` / `direct_sales.closed_at`). Cobrança de
--      renegociação não muda (já não lançava — 0189).
--   2. Quando a venda fecha, as cobranças dela ganham a receita, com a data
--      (competência) do FECHAMENTO — é o mês em que a venda aconteceu.
--   3. Cobrança apagada cancela a própria receita (status `cancelled`, nunca
--      apaga o lançamento — o razão continua imutável).
--   4. A "volta atrás" da 0226 (cobrança sai de cancelada → receita volta)
--      só reabre a receita se a venda estiver fechada.
--
-- O QUE NÃO MUDA: cobrança com dinheiro recebido continua com a receita como
-- está (venda antiga recebida antes da 0203 — apagar a receita deixaria o
-- dinheiro no caixa sem origem no resultado).
--
-- ACERTO DOS DADOS (seção 6): só muda o STATUS de lançamentos para
-- `cancelled` — nenhum dado é apagado, e o status volta sozinho a `open`
-- quando a venda fechar. Mês fechado (0231) não é tocado: fica de fora e
-- aparece na conferência.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Quando a venda da cobrança fechou (null = ainda não fechou)
-- -----------------------------------------------------------------------------
create or replace function public.installment_sale_closed_on(
  p_inst public.payment_installments
)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select case
    -- Renegociação: a dívida já era devida; nada a esperar.
    when p_inst.renegotiation_id is not null
      then coalesce(p_inst.created_at::date, current_date)
    when p_inst.direct_sale_id is not null
      then (select s.closed_at::date from public.direct_sales s
             where s.id = p_inst.direct_sale_id)
    when p_inst.negotiation_id is not null
      then (select cs.closed_at::date from public.commercial_sales cs
             where cs.negotiation_id = p_inst.negotiation_id)
    -- Cobrança sem venda de origem: comportamento antigo (não deveria existir).
    else coalesce(p_inst.created_at::date, current_date)
  end;
$$;

comment on function public.installment_sale_closed_on(public.payment_installments) is
  '0373: data em que a venda desta cobrança fechou (contrato assinado + '
  'pagamento confirmado). NULL = venda ainda não fechada → sem receita.';

revoke execute on function public.installment_sale_closed_on(public.payment_installments)
  from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2) Lançar a receita da cobrança — agora só com a venda fechada
-- -----------------------------------------------------------------------------
create or replace function public.post_installment_accrual(p_installment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inst public.payment_installments;
  v_account text;
  v_closed_on date;
  v_accrual date;
begin
  select * into v_inst from public.payment_installments where id = p_installment_id;
  if v_inst.id is null then return; end if;

  -- FIN2 (0189): a receita do serviço já foi reconhecida pela cobrança ORIGINAL.
  if v_inst.renegotiation_id is not null then return; end if;

  -- 0373: REGRA DE OURO também na receita. Cobrança de venda não fechada é só
  -- a PROPOSTA de pagamento — não é faturamento.
  v_closed_on := public.installment_sale_closed_on(v_inst);
  if v_closed_on is null then return; end if;

  -- Cobrança cancelada não ganha receita nova.
  if v_inst.status = 'cancelada' then return; end if;

  v_account := case
    when v_inst.direct_sale_id is not null then '1.1.02'
    else '1.1.01'
  end;

  -- Competência = o mês em que a venda fechou (ou, se a cobrança nasceu
  -- depois do fechamento, o dia em que ela nasceu).
  v_accrual := greatest(coalesce(v_inst.created_at::date, current_date), v_closed_on);

  insert into public.financial_entries (
    clinic_id, account_code, accrual_date, cash_date,
    expected_settlement_date, amount_cents, direction, status,
    source_type, source_id, description, created_by
  )
  values (
    v_inst.clinic_id, v_account, v_accrual,
    null, v_inst.due_date, v_inst.amount_cents, 'inflow', 'open',
    'installment_accrual', v_inst.id,
    case when v_inst.kind = 'entrada' then 'Entrada da venda'
         else 'Parcela ' || v_inst.seq end,
    v_inst.created_by
  )
  on conflict (source_type, source_id) where source_type in
    ('installment_accrual', 'receipt_cash', 'receipt_benefit',
     'receipt_late_fee', 'renegotiation_charges', 'renegotiation_benefit',
     'renegotiation_discount', 'renegotiation_surcharge')
  -- 0373: a receita que o acerto (seção 6) cancelou volta quando a venda
  -- fecha — com a data do fechamento e o valor atual da cobrança. Lançamento
  -- aberto, liquidado ou estornado NÃO é tocado.
  do update set
    status = 'open',
    accrual_date = excluded.accrual_date,
    amount_cents = excluded.amount_cents,
    expected_settlement_date = excluded.expected_settlement_date,
    updated_at = now()
  where public.financial_entries.status = 'cancelled';
end;
$$;

revoke execute on function public.post_installment_accrual(uuid) from public, anon, authenticated;
grant execute on function public.post_installment_accrual(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 3) A venda fechou → as cobranças dela ganham a receita
-- -----------------------------------------------------------------------------
create or replace function public.post_sale_accruals_on_close()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  for v_id in
    select i.id from public.payment_installments i
     where i.renegotiation_id is null
       and i.status <> 'cancelada'
       and ((tg_table_name = 'commercial_sales' and i.negotiation_id = new.negotiation_id)
         or (tg_table_name = 'direct_sales' and i.direct_sale_id = new.id))
  loop
    begin
      perform public.post_installment_accrual(v_id);
    exception when others then
      -- Mês já fechado na contabilidade (0231): o fechamento da VENDA não pode
      -- cair por isso (ele chega até pelo webhook da assinatura). Fica o aviso
      -- no log; `npm run check:dados` acusa venda fechada sem receita.
      if sqlerrm = 'PERIOD_CLOSED' then
        raise warning '0373: receita da cobrança % não lançada (mês fechado)', v_id;
      else
        raise;
      end if;
    end;
  end loop;
  return null;
end;
$$;

revoke execute on function public.post_sale_accruals_on_close() from public, anon, authenticated;

drop trigger if exists commercial_sales_post_accruals_upd on public.commercial_sales;
create trigger commercial_sales_post_accruals_upd
  after update of closed_at on public.commercial_sales
  for each row
  when (old.closed_at is null and new.closed_at is not null)
  execute function public.post_sale_accruals_on_close();

drop trigger if exists commercial_sales_post_accruals_ins on public.commercial_sales;
create trigger commercial_sales_post_accruals_ins
  after insert on public.commercial_sales
  for each row
  when (new.closed_at is not null)
  execute function public.post_sale_accruals_on_close();

drop trigger if exists direct_sales_post_accruals_upd on public.direct_sales;
create trigger direct_sales_post_accruals_upd
  after update of closed_at on public.direct_sales
  for each row
  when (old.closed_at is null and new.closed_at is not null)
  execute function public.post_sale_accruals_on_close();

drop trigger if exists direct_sales_post_accruals_ins on public.direct_sales;
create trigger direct_sales_post_accruals_ins
  after insert on public.direct_sales
  for each row
  when (new.closed_at is not null)
  execute function public.post_sale_accruals_on_close();

-- -----------------------------------------------------------------------------
-- 4) Cobrança apagada cancela a própria receita (o lançamento fica, cancelado)
-- -----------------------------------------------------------------------------
create or replace function public.cancel_accrual_of_deleted_installment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.financial_entries
     set status = 'cancelled', updated_at = now()
   where source_type = 'installment_accrual'
     and source_id = old.id
     and status = 'open';
  return old;
end;
$$;

revoke execute on function public.cancel_accrual_of_deleted_installment() from public, anon, authenticated;

drop trigger if exists payment_installments_cancel_accrual on public.payment_installments;
create trigger payment_installments_cancel_accrual
  before delete on public.payment_installments
  for each row execute function public.cancel_accrual_of_deleted_installment();

-- -----------------------------------------------------------------------------
-- 5) A "volta atrás" da 0226 só reabre receita de venda FECHADA
-- -----------------------------------------------------------------------------
create or replace function public.sync_installment_accrual_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'cancelada' and coalesce(new.paid_amount_cents, 0) = 0 then
    update public.financial_entries
       set status = 'cancelled', updated_at = now()
     where source_type = 'installment_accrual'
       and source_id = new.id
       and status = 'open';

  -- Volta atrás: se a parcela sair de cancelada, a receita volta — mas só se
  -- a venda estiver fechada (0373). Sem isso, uma cobrança da proposta que
  -- mudasse de situação ressuscitaria a receita que o acerto cancelou.
  elsif new.status <> 'cancelada'
        and public.installment_sale_closed_on(new) is not null then
    update public.financial_entries
       set status = 'open', updated_at = now()
     where source_type = 'installment_accrual'
       and source_id = new.id
       and status = 'cancelled';
  end if;
  return null;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6) ACERTO DOS DADOS — só status, nada apagado; mês fechado fica de fora
-- -----------------------------------------------------------------------------
-- 6a) Receita "órfã": a cobrança foi apagada (salvar a negociação de novo) e
--     o lançamento ficou aberto. É a receita EM DOBRO.
update public.financial_entries e
   set status = 'cancelled', updated_at = now()
 where e.source_type = 'installment_accrual'
   and e.status = 'open'
   and not exists (select 1 from public.payment_installments i where i.id = e.source_id)
   and not exists (
     select 1 from public.fiscal_periods p
      where p.clinic_id = e.clinic_id and p.status = 'closed'
        and p.year = extract(year from e.accrual_date)::integer
        and p.month = extract(month from e.accrual_date)::integer);

-- 6b) Receita de venda que ainda NÃO fechou, sem dinheiro recebido. Volta
--     sozinha (seção 2) quando a venda fechar.
update public.financial_entries e
   set status = 'cancelled', updated_at = now()
  from public.payment_installments i
 where e.source_type = 'installment_accrual'
   and e.source_id = i.id
   and e.status = 'open'
   and i.renegotiation_id is null
   and public.installment_sale_closed_on(i) is null
   and coalesce(i.paid_amount_cents, 0) = 0
   and not exists (select 1 from public.payment_receipts r where r.installment_id = i.id)
   and not exists (
     select 1 from public.fiscal_periods p
      where p.clinic_id = e.clinic_id and p.status = 'closed'
        and p.year = extract(year from e.accrual_date)::integer
        and p.month = extract(month from e.accrual_date)::integer);

-- -----------------------------------------------------------------------------
-- Conferência (só contagens e valores — nenhum dado pessoal)
-- -----------------------------------------------------------------------------
select
  (select count(*) from public.financial_entries e
    where e.source_type = 'installment_accrual' and e.status = 'open'
      and not exists (select 1 from public.payment_installments i where i.id = e.source_id))
    as orfas_ainda_abertas_esperado_0_salvo_mes_fechado,
  (select count(*) from public.financial_entries e
     join public.payment_installments i on i.id = e.source_id
    where e.source_type = 'installment_accrual' and e.status = 'open'
      and i.renegotiation_id is null
      and public.installment_sale_closed_on(i) is null
      and coalesce(i.paid_amount_cents, 0) = 0)
    as venda_aberta_com_receita_esperado_0_salvo_mes_fechado,
  (select count(*) from pg_trigger
    where tgname in ('commercial_sales_post_accruals_upd', 'commercial_sales_post_accruals_ins',
                     'direct_sales_post_accruals_upd', 'direct_sales_post_accruals_ins',
                     'payment_installments_cancel_accrual')
      and not tgisinternal) as gatilhos_esperado_5;
