-- =============================================================================
-- 0300 — AS PARCELAS DA NOTA: O TEXTO DIZ O QUE ELAS SÃO, E DÁ PARA PAGAR TODAS (OC-00109)
--
-- Relato OC-00109 (Financeiro da Franqueadora, treino, 16/10/2026): depois de
-- importar o XML, "o sistema pega o valor total da nota e divide pela
-- quantidade de linha" — e para pagar "tenho que baixar linha a linha".
--
-- O DIAGNÓSTICO (medido no treino): o sistema NÃO divide a nota pelas linhas.
-- As 12 contas de R$ 137,33 são as 12 DUPLICATAS que o próprio fornecedor pôs
-- no XML (cartão de crédito, a prazo; 11 × 137,33 + 137,37 = R$ 1.648,00). Os
-- 17 produtos, com o valor real de cada um, entraram no ESTOQUE. A regra é a
-- da 0223: as duplicatas da nota são os vencimentos.
--
-- O QUE ESTAVA ERRADO era o TEXTO: cada parcela dizia "Compra de material — NF
-- 2852836 (17 itemns)" — com o erro de digitação ("item" + "ns") e sem dizer
-- que era a parcela 1 de 12. Lida assim, parecia uma linha da nota.
--
-- O QUE MUDA (decisões do dono, 16/10/2026):
--   1. `stock_purchase_payable_description()` — UMA regra para o texto:
--      "Compra de material — NF 2852836 · parcela 1/12 · boleto (17 itens)"
--      (a parcela só quando há mais de uma; a forma só quando informada).
--   2. `register_stock_purchase()` usa essa regra, com o número da parcela e a
--      forma de pagamento que vier em cada parcela. O resto é a 0223, copiado
--      por script (mesma assinatura e retorno).
--   3. As contas de nota que JÁ EXISTEM ganham o texto novo (decisão do dono):
--      muda SÓ a descrição — valor, vencimento e situação não. A auditoria
--      registra a troca.
--   4. `pay_stock_purchase()` — "Pagar todas as parcelas desta nota": dá
--      baixa no que falta de cada parcela em aberto, com a mesma data e o mesmo
--      meio, chamando `register_payable_payment` PARCELA A PARCELA — a mesma
--      porta do botão Pagar, com todas as regras dela (permissão, razão
--      contábil, período fechado). Tudo ou nada. Parcela aguardando
--      autorização fica de fora, e a resposta diz quantas.
--
-- Nenhuma tabela nova. Nada apaga dado. Idempotente.
-- =============================================================================

-- 1) Uma regra só para o texto ------------------------------------------------
create or replace function public.stock_purchase_payable_description(
  p_invoice_number text,
  p_parcela int,
  p_parcelas int,
  p_forma text,
  p_itens int
)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'Compra de material'
    || case when coalesce(btrim(p_invoice_number), '') <> ''
            then ' — NF ' || btrim(p_invoice_number) else '' end
    || case when coalesce(p_parcelas, 1) > 1 and p_parcela is not null
            then ' · parcela ' || p_parcela || '/' || p_parcelas else '' end
    || coalesce(' · ' || case p_forma
         when 'pix' then 'PIX'
         when 'boleto' then 'boleto'
         when 'transferencia' then 'transferência'
         when 'debito_automatico' then 'débito automático'
         when 'cartao' then 'cartão'
         when 'dinheiro' then 'dinheiro'
       end, '')
    || ' (' || coalesce(p_itens, 0)
    || case when p_itens = 1 then ' item' else ' itens' end || ')';
$$;

revoke execute on function public.stock_purchase_payable_description(text, int, int, text, int) from public, anon, authenticated;
grant execute on function public.stock_purchase_payable_description(text, int, int, text, int) to authenticated;

-- 2) A compra grava cada parcela com o texto novo ------------------------------
create or replace function public.register_stock_purchase(
  p_clinic_id uuid,
  p_supplier_id uuid,
  p_invoice_number text,
  p_issue_date date,
  p_items jsonb,
  p_installments jsonb,
  p_cost_center_id uuid default null,
  p_notes text default null,
  p_nfe_key text default null,
  p_xml_path text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purchase uuid;
  v_payable uuid;
  v_item jsonb;
  v_inst jsonb;
  v_total bigint := 0;
  v_line bigint;
  v_user uuid := (select auth.uid());
  v_when date := coalesce(p_issue_date, public.today_br());
  v_count integer := 0;
  -- OC-00109: a parcela sabe quem ela é (1/12) e como vai ser paga.
  v_n integer := jsonb_array_length(coalesce(p_installments, '[]'::jsonb));
  v_i bigint;
  v_key text := nullif(regexp_replace(coalesce(p_nfe_key, ''), '\D', '', 'g'), '');
begin
  if not public.can_manage_stock(p_clinic_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'NO_ITEMS';
  end if;
  if p_installments is null or jsonb_array_length(p_installments) = 0 then
    raise exception 'NO_INSTALLMENTS';
  end if;

  if v_key is not null and exists (
    select 1 from public.stock_purchases
    where clinic_id = p_clinic_id and nfe_key = v_key
  ) then
    raise exception 'NFE_ALREADY_IMPORTED';
  end if;

  insert into public.stock_purchases (
    clinic_id, supplier_id, invoice_number, issue_date, notes, created_by,
    nfe_key, xml_path
  ) values (
    p_clinic_id, p_supplier_id,
    nullif(btrim(coalesce(p_invoice_number, '')), ''), v_when,
    nullif(btrim(coalesce(p_notes, '')), ''), v_user,
    v_key, nullif(btrim(coalesce(p_xml_path, '')), '')
  )
  returning id into v_purchase;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_line := round((v_item->>'packages')::numeric
                    * (v_item->>'packageCostCents')::numeric)::bigint;
    v_total := v_total + v_line;
    v_count := v_count + 1;

    perform public.apply_stock_movement(
      p_clinic_id => p_clinic_id,
      p_item_id => (v_item->>'itemId')::uuid,
      p_kind => 'entrada',
      p_movement_date => v_when,
      p_source_type => 'purchase',
      p_source_id => v_purchase,
      p_purchase_quantity => (v_item->>'packages')::numeric,
      p_purchase_unit_cost_cents => (v_item->>'packageCostCents')::bigint,
      p_lot_code => nullif(v_item->>'lotCode', ''),
      p_expires_at => nullif(v_item->>'expiresAt', '')::date,
      p_supplier_id => p_supplier_id,
      p_invoice_number => nullif(btrim(coalesce(p_invoice_number, '')), '')
    );

    -- APRENDE: a confirmação de quem importou vira o vínculo da próxima nota.
    if coalesce(v_item->>'supplierCode', '') <> ''
       and coalesce(v_item->>'supplierCnpj', '') <> '' then
      perform public.link_supplier_item(
        v_item->>'supplierCnpj',
        v_item->>'supplierCode',
        (v_item->>'itemId')::uuid,
        v_item->>'supplierDescription',
        v_item->>'gtin'
      );
    end if;
  end loop;

  update public.stock_purchases set total_cents = v_total where id = v_purchase;

  for v_inst, v_i in
    select e, o from jsonb_array_elements(p_installments) with ordinality as t(e, o)
  loop
    v_payable := public.save_payable(
      p_clinic_id => p_clinic_id,
      p_supplier_id => p_supplier_id,
      p_account_code => '6.1.01',
      p_cost_center_id => p_cost_center_id,
      p_description => public.stock_purchase_payable_description(
        p_invoice_number, v_i::int, v_n, v_inst->>'paymentMethod', v_count),
      p_amount_cents => (v_inst->>'amountCents')::bigint,
      p_due_date => (v_inst->>'dueDate')::date,
      p_accrual_date => v_when,
      p_document_number => nullif(btrim(coalesce(p_invoice_number, '')), '')
    );

    update public.payables set stock_purchase_id = v_purchase
     where id = v_payable;
  end loop;

  return v_purchase;
end;
$$;

-- 3) As contas de nota que já existem ganham o texto novo ----------------------
-- Só a descrição. O número de itens é o que a descrição antiga já dizia; a
-- parcela é a ordem por vencimento dentro da mesma compra.
with parcelas as (
  select p.id,
         sp.invoice_number,
         row_number() over (partition by p.stock_purchase_id order by p.due_date, p.created_at, p.id)::int as i,
         count(*) over (partition by p.stock_purchase_id)::int as n,
         (regexp_match(p.description, '\((\d+) item(?:ns|s)?\)$'))[1]::int as itens
  from public.payables p
  join public.stock_purchases sp on sp.id = p.stock_purchase_id
  where p.description like 'Compra de material%'
)
update public.payables p
   set description = public.stock_purchase_payable_description(x.invoice_number, x.i, x.n, null, x.itens)
  from parcelas x
 where p.id = x.id
   and x.itens is not null
   and p.description not like '% · parcela %'
   and p.description is distinct from public.stock_purchase_payable_description(x.invoice_number, x.i, x.n, null, x.itens);

-- 4) Pagar todas as parcelas da nota -------------------------------------------
create or replace function public.pay_stock_purchase(
  p_purchase_id uuid,
  p_paid_at date,
  p_payment_method text,
  p_reference text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purchase record;
  v_p record;
  v_saldo bigint;
  v_pagas int := 0;
  v_total bigint := 0;
  v_aguardando int := 0;
begin
  select * into v_purchase from public.stock_purchases where id = p_purchase_id;
  if v_purchase.id is null then raise exception 'PURCHASE_NOT_FOUND'; end if;
  if not public.can_manage_payables(v_purchase.clinic_id) then
    raise exception 'NOT_ALLOWED';
  end if;

  select count(*)::int into v_aguardando
  from public.payables
  where stock_purchase_id = p_purchase_id and status = 'aguardando_autorizacao';

  for v_p in
    select * from public.payables
    where stock_purchase_id = p_purchase_id and status in ('aberta', 'parcial')
    order by due_date, created_at, id
  loop
    -- O que falta desta parcela: a mesma conta do register_payable_payment.
    select v_p.amount_cents - coalesce(sum(amount_cents + coalesce(discount_cents, 0)), 0)
      into v_saldo
    from public.payable_payments
    where payable_id = v_p.id and not reversed and reversal_of is null;

    if v_saldo > 0 then
      perform public.register_payable_payment(
        p_payable_id => v_p.id,
        p_amount_cents => v_saldo,
        p_paid_at => p_paid_at,
        p_payment_method => p_payment_method,
        p_fee_cents => 0,
        p_interest_cents => 0,
        p_reference => p_reference,
        p_notes => p_notes,
        p_client_token => gen_random_uuid(),
        p_discount_cents => 0
      );
      v_pagas := v_pagas + 1;
      v_total := v_total + v_saldo;
    end if;
  end loop;

  if v_pagas = 0 then raise exception 'NOTHING_TO_PAY'; end if;

  return jsonb_build_object('pagas', v_pagas, 'total_cents', v_total, 'aguardando', v_aguardando);
end;
$$;

revoke execute on function public.pay_stock_purchase(uuid, date, text, text, text) from public, anon, authenticated;
grant execute on function public.pay_stock_purchase(uuid, date, text, text, text) to authenticated;
