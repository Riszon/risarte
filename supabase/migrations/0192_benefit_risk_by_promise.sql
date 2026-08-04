-- =============================================================================
-- 0192 — FIN2.3: o benefício corre risco em TODA promessa de pagamento
-- -----------------------------------------------------------------------------
-- BUG relatado pelo dono (04/08/2026, print da VD-00038): venda com benefício
-- de R$ 300,00, parcelada em 4 vezes com vencimentos mensais, e o sistema não
-- marcava NADA de benefício em risco. A parcela venceu, ficou 4 dias em atraso,
-- e o cliente manteve o desconto.
--
-- Diagnóstico no banco: o cálculo estava certo (benefício recuperável = R$
-- 300,00, já excluindo a limpeza que ficou gratuita). O errado era a REGRA que
-- eu escrevi na 0188: ela olhava o RÓTULO do meio de pagamento e só aceitava
-- 'boleto' e 'credito_recorrente'. A VD-00038 foi fechada como **PIX em 4x com
-- vencimentos futuros** — que é, na prática, exatamente o mesmo risco de um
-- boleto: o dinheiro não entrou, e o cliente pode atrasar.
--
-- O critério do dono nunca foi o rótulo, foi o RISCO. Nas palavras dele:
-- "no caso de cartão de crédito parcelado ou pagamento à vista esta regra não
-- se aplica pois quando o cliente faz o fechamento e pagou com o cartão de
-- crédito já não tem risco de inadimplência".
--
-- Regra corrigida: **toda cobrança é promessa de pagamento e corre risco,
-- EXCETO no cartão** ('cartao' e 'cartao_parcelado'), onde a adquirente
-- garante o dinheiro no fechamento. PIX, boleto, recorrência, depósito e
-- dinheiro com vencimento futuro entram todos.
-- Idempotente.
-- =============================================================================

create or replace function public.apply_sale_benefit_risk(
  p_negotiation_id uuid,
  p_direct_sale_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_benefit bigint;
  v_sum bigint;
  v_last uuid;
  v_diff bigint;
  v_method text;
begin
  v_benefit := public.sale_recoverable_benefit_cents(
    p_negotiation_id, p_direct_sale_id);

  if p_negotiation_id is not null then
    select n.payment_method into v_method
    from public.plan_negotiations n where n.id = p_negotiation_id;
  else
    select s.payment_method into v_method
    from public.direct_sales s where s.id = p_direct_sale_id;
  end if;

  select coalesce(sum(amount_cents), 0) into v_sum
  from public.payment_installments
  where (p_negotiation_id is not null and negotiation_id = p_negotiation_id)
     or (p_direct_sale_id is not null and direct_sale_id = p_direct_sale_id);

  if v_sum <= 0 then return; end if;

  update public.payment_installments t
     set benefit_discount_cents = case
       -- 0192: só o CARTÃO não corre risco — a adquirente já garantiu o
       -- dinheiro no fechamento. Todo o resto é promessa de pagamento.
       when coalesce(t.payment_method, v_method) in ('cartao', 'cartao_parcelado')
         then 0
       else floor(v_benefit::numeric * t.amount_cents / v_sum)
     end
   where ((p_negotiation_id is not null and t.negotiation_id = p_negotiation_id)
      or (p_direct_sale_id is not null and t.direct_sale_id = p_direct_sale_id))
     -- Cobrança já quitada não muda de valor no meio do caminho.
     and t.status in ('em_aberto', 'parcial');

  -- Resíduo do rateio na última parcela que corre risco.
  select id into v_last
  from public.payment_installments
  where ((p_negotiation_id is not null and negotiation_id = p_negotiation_id)
      or (p_direct_sale_id is not null and direct_sale_id = p_direct_sale_id))
    and benefit_discount_cents > 0
  order by seq desc limit 1;

  if v_last is null then return; end if;

  select v_benefit - coalesce(sum(benefit_discount_cents), 0) into v_diff
  from public.payment_installments
  where (p_negotiation_id is not null and negotiation_id = p_negotiation_id)
     or (p_direct_sale_id is not null and direct_sale_id = p_direct_sale_id);

  if v_diff <> 0 then
    update public.payment_installments
       set benefit_discount_cents = greatest(0, benefit_discount_cents + v_diff)
     where id = v_last;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Reparo: reavalia todas as vendas com cobrança em aberto
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
    perform public.apply_sale_benefit_risk(r.negotiation_id, r.direct_sale_id);
  end loop;
end $$;

select
  count(*) filter (where benefit_discount_cents > 0) as parcelas_com_beneficio_em_risco,
  coalesce(sum(benefit_discount_cents), 0) / 100.0 as total_em_risco_reais
from public.payment_installments
where status in ('em_aberto', 'parcial');
