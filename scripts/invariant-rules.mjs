// AS REGRAS DAS INVARIANTES — funções puras, sem banco.
//
// Ficam separadas do `check-invariants.mjs` (que só lê e imprime) para poderem
// ser presas em teste: cada uma é exercitada com os DEFEITOS REAIS que já
// chegaram ao dono. Conferência que ninguém provou que dispara é conferência
// que passa por cegueira, não por saúde — foi assim que uma regra do verificador
// de migração ficou decorativa até ser testada.

const TOL = 0.001; // as quantidades têm 3 casas decimais

/**
 * Venda cancelada que continua como receita.
 *
 * O defeito da 0226: cancelar a parcela deixava o lançamento de competência
 * aberto para sempre. Só conta a parcela SEM recebimento — quem já pagou mantém
 * a receita, senão o dinheiro ficaria no caixa sem origem no resultado.
 */
export function cancelledStillRevenue(entries, installments) {
  const byId = new Map(installments.map((i) => [i.id, i]));
  return entries.filter((e) => {
    if (e.source_type !== "installment_accrual" || e.status !== "open") {
      return false;
    }
    const inst = byId.get(e.source_id);
    return inst?.status === "cancelada" && !inst.paid_amount_cents;
  });
}

/**
 * Competência e caixa misturados.
 *
 * A separação que faz a DRE e o fluxo lerem metades diferentes do mesmo razão:
 * lançamento de competência não tem data de caixa, e o de liquidação tem.
 */
export function mixedAccrualAndCash(entries) {
  return {
    accrualWithCash: entries.filter(
      (e) => e.source_type === "installment_accrual" && e.cash_date !== null
    ),
    cashWithoutDate: entries.filter(
      (e) =>
        ["receipt_cash", "payable_cash"].includes(e.source_type) &&
        e.cash_date === null
    ),
  };
}

/**
 * Contra-lançamento apontando para original que não está marcado.
 *
 * Sem o par completo, o estorno entraria nos relatórios com o sinal invertido —
 * uma receita estornada viraria despesa.
 */
export function orphanReversals(entries) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  return entries.filter(
    (e) => e.reversal_of && byId.get(e.reversal_of)?.status !== "reversed"
  );
}

/**
 * Conta marcada como paga sem estar quitada.
 *
 * Pago + desconto por pontualidade (0235) tem de cobrir o valor. Foi a regra que
 * fez a conta de R$ 1.000 paga com R$ 900 mais R$ 100 de abatimento deixar de
 * ficar "parcial" para sempre.
 */
export function paidButNotSettled(payables, payments) {
  const discount = new Map();
  for (const p of payments) {
    if (p.reversed || p.reversal_of) continue;
    discount.set(
      p.payable_id,
      (discount.get(p.payable_id) ?? 0) + (p.discount_cents ?? 0)
    );
  }
  return payables.filter(
    (p) =>
      p.status === "paga" &&
      p.paid_amount_cents + (discount.get(p.id) ?? 0) < p.amount_cents
  );
}

/** Bem depreciado além do que custou (a trava da 0224). */
export function overDepreciated(assets, depreciations) {
  const total = new Map();
  for (const d of depreciations) {
    total.set(d.asset_id, (total.get(d.asset_id) ?? 0) + d.amount_cents);
  }
  return assets.filter((a) => (total.get(a.id) ?? 0) > a.cost_cents);
}

export const STOCK_IN = ["entrada", "ajuste_entrada", "transferencia_entrada"];
export const STOCK_OUT = [
  "consumo",
  "perda",
  "ajuste_saida",
  "transferencia_saida",
];
/** `abertura` passa a embalagem da prateleira para "em uso": não muda o total. */
export const STOCK_NEUTRAL = ["abertura"];

/**
 * Tipo de movimento que a conferência não conhece.
 *
 * Existe porque o silêncio é o pior resultado: um tipo novo seria ignorado e o
 * saldo continuaria "batendo" por omissão.
 */
export function unknownMovementKinds(movements) {
  const known = new Set([...STOCK_IN, ...STOCK_OUT, ...STOCK_NEUTRAL]);
  return [...new Set(movements.map((m) => m.kind))].filter(
    (k) => !known.has(k)
  );
}

/**
 * Saldo do estoque diferente da soma dos movimentos.
 *
 * A conta é sobre `quantity + in_use_quantity`, porque a abertura de embalagem
 * move entre as duas colunas sem mudar o total. Divergir significa que algum
 * caminho escreveu no saldo sem passar pelo movimento — e aí a prateleira deixa
 * de explicar o número.
 */
export function balanceMismatch(balances, movements) {
  const sum = new Map();
  for (const m of movements) {
    const key = `${m.clinic_id}|${m.item_id}`;
    const sign = STOCK_IN.includes(m.kind)
      ? 1
      : STOCK_OUT.includes(m.kind)
        ? -1
        : 0;
    sum.set(key, (sum.get(key) ?? 0) + sign * Number(m.quantity));
  }
  return balances.filter((b) => {
    const expected = sum.get(`${b.clinic_id}|${b.item_id}`) ?? 0;
    const real = Number(b.quantity) + Number(b.in_use_quantity ?? 0);
    return Math.abs(real - expected) > TOL;
  });
}

/**
 * Rateio da rodada que não soma o total comprado.
 *
 * A sobra dos arredondamentos vai para quem mais pediu — sem isso, comprar 45
 * do que 47 foi pedido deixaria fração espalhada.
 */
export function allocationMismatch(roundItems, allocations) {
  const given = new Map();
  for (const a of allocations) {
    given.set(
      a.round_item_id,
      (given.get(a.round_item_id) ?? 0) + Number(a.allocated_quantity)
    );
  }
  return roundItems.filter((ri) => {
    if (!ri.awarded_supplier_id || !given.has(ri.id)) return false;
    const bought = Number(ri.adjusted_quantity ?? ri.requested_quantity);
    return Math.abs(given.get(ri.id) - bought) > TOL;
  });
}

/** Recebido do pedido diferente da soma das entregas. */
export function receivedMismatch(orderItems, receiptItems) {
  const received = new Map();
  for (const r of receiptItems) {
    received.set(
      r.order_item_id,
      (received.get(r.order_item_id) ?? 0) + Number(r.quantity)
    );
  }
  return orderItems.filter(
    (oi) =>
      Math.abs(Number(oi.received_quantity) - (received.get(oi.id) ?? 0)) > TOL
  );
}

/**
 * Conta da taxa diferente da soma dos recebimentos que a geraram.
 *
 * Só vale para taxa PERCENTUAL: a fixa não tem split, e cobrá-la dessa conta
 * acusaria toda taxa de sistema do mês.
 */
export function feePayableMismatch(splits, feePayables) {
  const sum = new Map();
  for (const s of splits) {
    if (s.reversed) continue;
    const key = `${s.clinic_id}|${s.fee}|${s.period_month}`;
    sum.set(key, (sum.get(key) ?? 0) + s.amount_cents);
  }
  return feePayables.filter((p) => {
    if (p.status === "cancelada") return false;
    const key = `${p.clinic_id}|${p.network_fee}|${p.fee_period}`;
    if (!sum.has(key)) return false;
    return sum.get(key) !== p.amount_cents;
  });
}
