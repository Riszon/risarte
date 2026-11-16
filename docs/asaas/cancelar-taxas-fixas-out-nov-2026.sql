-- Cancelar as taxas fixas (SDR e tecnologia) de 10/2026 e 11/2026 de Cambé e
-- Londrina — pedido do dono em 16/11/2026: "apagar estes lançamentos, e vamos
-- lançar essas taxas a partir do mês que vem". Rodar no SQL Editor da PRODUÇÃO.
--
-- NÃO APAGA NADA: o razão não deixa apagar lançamento. As 8 contas a pagar ficam
-- CANCELADAS, com o motivo, e os lançamentos delas (a despesa da unidade e a
-- receita da franqueadora) ficam cancelados. Dezembro nasce sozinho no dia 1º/12.
--
-- UM COMANDO SÓ: ou grava tudo, ou nada. Se não achar exatamente as 8 contas,
-- não muda nada (e mostra quantas achou). Se um mês estiver fechado na
-- contabilidade, o banco recusa (PERIOD_CLOSED) e nada é gravado.
--
-- Conferência esperada: achadas 8 | contas_canceladas 8 | lancamentos_cancelados 16

with alvo as (
  select p.id
    from public.payables p
    join public.clinics c on c.id = p.clinic_id
   where c.name in ('Risarte Cambé - Centro', 'Risarte Londrina - Centro')
     and p.network_fee in ('sdr', 'sistema')
     and p.fee_period in ('2026-10-01', '2026-11-01')
     and p.status = 'aberta'
     and p.paid_amount_cents = 0
),
total as (select count(*) as n from alvo),
contas as (
  update public.payables
     set status = 'cancelada',
         cancel_reason = 'Cancelada a pedido do dono (16/11/2026): as taxas fixas começam em 12/2026.',
         cancelled_at = now(),
         updated_at = now()
   where id in (select id from alvo) and (select n from total) = 8
  returning id
),
lancamentos as (
  update public.financial_entries
     set status = 'cancelled', updated_at = now()
   where source_type in ('payable_accrual', 'network_fee_revenue')
     and source_id in (select id from alvo)
     and status = 'open'
     and (select n from total) = 8
  returning id
)
select (select n from total) as achadas,
       (select count(*) from contas) as contas_canceladas,
       (select count(*) from lancamentos) as lancamentos_cancelados;

-- =============================================================================
-- COMO DESFAZER (só se precisar; NÃO rodar junto) — também um comando só:
-- with contas as (
--   update public.payables set status = 'aberta', cancel_reason = null, cancelled_at = null, updated_at = now()
--    where cancel_reason = 'Cancelada a pedido do dono (16/11/2026): as taxas fixas começam em 12/2026.'
--   returning id
-- ), lancamentos as (
--   update public.financial_entries set status = 'open', updated_at = now()
--    where source_type in ('payable_accrual', 'network_fee_revenue') and status = 'cancelled'
--      and source_id in (select id from contas)
--   returning id
-- )
-- select (select count(*) from contas) as contas_reabertas, (select count(*) from lancamentos) as lancamentos_reabertos;
-- =============================================================================
