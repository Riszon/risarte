-- =============================================================================
-- 0302 — PAGAR A CONTA A PAGAR PELA CONCILIAÇÃO (OC-00110)
--
-- Relato OC-00110 (Financeiro da Franqueadora, treino, 16/10/2026): "realizei a
-- conciliação de alguns itens, mas não entrou no DRE". O que se achou:
--
--   - NÃO ERA DEFEITO. As 3 linhas foram LANÇADAS pela conciliação (Aluguel,
--     Material de escritório, Eventos) e estão na DRE — na competência de
--     SETEMBRO, o mês da linha do extrato. O print era da DRE de outubro.
--     Conserto: o texto (a tela passa a dizer em que mês entra).
--   - A LACUNA: a conciliação não conversava com Contas a pagar. O caminho era
--     pagar a conta lá e depois "Casar" a linha aqui — e quem lançava a linha
--     pelo "Lançar" contava a despesa duas vezes (a conta a pagar já está na
--     DRE desde que foi lançada) e a conta continuava em aberto.
--
-- O QUE MUDA (decisão do dono, 17/10/2026): `pay_payable_from_bank_transaction`
-- dá a baixa da conta a pagar com a data do extrato E concilia a linha com o
-- pagamento, numa transação só. Não é um caminho novo para o dinheiro: chama
-- `register_payable_payment` (a mesma baixa de Contas a pagar — caixa, multa,
-- desconto, regras) e `reconcile_bank_transaction` (o mesmo Casar). Só aceita
-- o valor EXATO do saldo da conta: conta com multa ou juros se paga em Contas
-- a pagar e a linha se casa por "Vários".
--
-- Nenhuma tabela nova. Nada apaga dado. Idempotente.
-- =============================================================================

create or replace function public.pay_payable_from_bank_transaction(
  p_transaction_id uuid,
  p_payable_id uuid,
  p_payment_method text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx record;
  v_p record;
  v_saldo bigint;
  v_pagamento uuid;
  v_lancamento uuid;
begin
  select * into v_tx from public.bank_transactions where id = p_transaction_id;
  if v_tx.id is null then raise exception 'TRANSACTION_NOT_FOUND'; end if;
  if not public.can_reconcile(v_tx.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  if v_tx.status <> 'pendente' then raise exception 'NOT_PENDING'; end if;
  -- Pagar conta é dinheiro SAINDO da conta do banco.
  if v_tx.amount_cents >= 0 then raise exception 'NOT_AN_OUTFLOW'; end if;

  select * into v_p from public.payables where id = p_payable_id;
  if v_p.id is null then raise exception 'PAYABLE_NOT_FOUND'; end if;
  if v_p.clinic_id <> v_tx.clinic_id then raise exception 'CLINIC_MISMATCH'; end if;

  -- O saldo pela MESMA conta da baixa (pago + desconto, sem estornos).
  select v_p.amount_cents - coalesce(sum(amount_cents + coalesce(discount_cents, 0)), 0)
    into v_saldo
  from public.payable_payments
  where payable_id = p_payable_id and not reversed and reversal_of is null;
  if v_saldo <> -v_tx.amount_cents then raise exception 'AMOUNT_MISMATCH'; end if;

  -- A baixa de sempre: ela confere permissão, autorização e situação da conta.
  v_pagamento := public.register_payable_payment(
    p_payable_id,
    -v_tx.amount_cents,
    v_tx.posted_at,
    nullif(btrim(p_payment_method), ''),
    0, 0, null,
    'Pago pela conciliação do extrato',
    null, 0
  );

  select id into v_lancamento
  from public.financial_entries
  where source_type = 'payable_cash' and source_id = v_pagamento;
  if v_lancamento is null then raise exception 'ENTRY_NOT_FOUND'; end if;

  -- E o Casar de sempre: valor e sentido conferidos de novo.
  perform public.reconcile_bank_transaction(p_transaction_id, v_lancamento);

  return v_pagamento;
end;
$$;

revoke execute on function public.pay_payable_from_bank_transaction(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.pay_payable_from_bank_transaction(uuid, uuid, text) to authenticated;
