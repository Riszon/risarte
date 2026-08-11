// Estoque — as regras de saldo e custo, fora de qualquer tela.
//
// O documento base do Financeiro registra qual é o jeito deste módulo morrer:
// "falta de baixa no uso". Por isso o consumo nasce do KIT do procedimento, e
// não de alguém digitando no meio do atendimento.
//
// Duas regras carregam o módulo inteiro:
//
//   • O SALDO É PROJEÇÃO, não base. Ele é o resultado de aplicar os movimentos
//     em ordem — e por isso pode ser reconstruído quando alguém desconfiar.
//   • CUSTO MÉDIO PONDERADO: a entrada recalcula o médio; a saída sai pelo
//     médio vigente e CONGELA esse valor. Comprar mais caro amanhã não
//     reescreve o custo do que foi usado ontem (a mesma regra do repasse).

import { roundHalfUp } from "./finance/money";

export const MOVEMENT_KINDS = [
  "entrada",
  "consumo",
  "perda",
  "ajuste_entrada",
  "ajuste_saida",
  "transferencia_entrada",
  "transferencia_saida",
] as const;

export type MovementKind = (typeof MOVEMENT_KINDS)[number];

export const MOVEMENT_LABELS: Record<MovementKind, string> = {
  entrada: "Entrada",
  consumo: "Consumo",
  perda: "Perda / descarte",
  ajuste_entrada: "Ajuste (sobra)",
  ajuste_saida: "Ajuste (falta)",
  transferencia_entrada: "Transferência recebida",
  transferencia_saida: "Transferência enviada",
};

/** Movimentos que o usuário lança à mão (transferência é da E5). */
export const MANUAL_KINDS: MovementKind[] = [
  "entrada",
  "consumo",
  "perda",
  "ajuste_entrada",
  "ajuste_saida",
];

export function isInbound(kind: MovementKind): boolean {
  return (
    kind === "entrada" ||
    kind === "ajuste_entrada" ||
    kind === "transferencia_entrada"
  );
}

export type Balance = {
  /** Quantidade em estoque. Pode ficar NEGATIVA — ver `applyMovement`. */
  quantity: number;
  avgCostCents: number;
  minQuantity: number;
};

export type MovementInput = {
  kind: MovementKind;
  quantity: number;
  /** Só na entrada; na saída o custo vem do médio vigente. */
  unitCostCents?: number;
};

export type MovementResult = {
  balance: Balance;
  /** Custo unitário CONGELADO neste movimento. */
  unitCostCents: number;
  totalCents: number;
};

/**
 * A média ponderada.
 *
 * Com saldo zerado ou negativo não há média a ponderar: o custo da entrada
 * passa a ser o custo. Ponderar contra saldo negativo devolveria um número sem
 * significado nenhum — e um custo médio errado contamina o preço de todo
 * procedimento que usa o item.
 */
export function weightedAverage(
  currentQty: number,
  currentAvgCents: number,
  inQty: number,
  inCostCents: number
): number {
  const newQty = currentQty + inQty;
  if (currentQty <= 0 || newQty <= 0) return Math.max(0, Math.round(inCostCents));
  return roundHalfUp(
    (currentQty * currentAvgCents + inQty * inCostCents) / newQty
  );
}

/**
 * Aplica um movimento ao saldo.
 *
 * SAÍDA NÃO É RECUSADA POR FALTA DE SALDO. O saldo fica negativo e o alerta
 * aparece — travar aqui significaria travar um atendimento por causa de
 * cadastro, que é exatamente o erro que a baixa da adquirente ensinou a não
 * repetir. Saldo negativo é informação útil: alguém consumiu sem ter dado
 * entrada.
 */
export function applyMovement(
  balance: Balance,
  movement: MovementInput
): MovementResult {
  const qty = Math.max(0, movement.quantity);
  const inbound = isInbound(movement.kind);

  if (inbound) {
    const unit = Math.max(
      0,
      Math.round(movement.unitCostCents ?? balance.avgCostCents)
    );
    const avg = weightedAverage(balance.quantity, balance.avgCostCents, qty, unit);
    return {
      balance: {
        ...balance,
        quantity: balance.quantity + qty,
        avgCostCents: avg,
      },
      unitCostCents: unit,
      totalCents: roundHalfUp(qty * unit),
    };
  }

  const unit = balance.avgCostCents;
  return {
    balance: { ...balance, quantity: balance.quantity - qty },
    unitCostCents: unit,
    totalCents: roundHalfUp(qty * unit),
  };
}

/** Reconstrói o saldo do zero — o teste de que a projeção não mentiu. */
export function replayMovements(movements: MovementInput[]): Balance {
  let balance: Balance = { quantity: 0, avgCostCents: 0, minQuantity: 0 };
  for (const m of movements) balance = applyMovement(balance, m).balance;
  return balance;
}

export type StockAlert = "negativo" | "abaixo_minimo" | "sem_custo";

/**
 * O que está errado neste saldo. Ordem importa: negativo é mais grave que
 * abaixo do mínimo, e é o único que denuncia consumo sem entrada.
 */
export function balanceAlerts(balance: Balance): StockAlert[] {
  const alerts: StockAlert[] = [];
  if (balance.quantity < 0) alerts.push("negativo");
  else if (balance.minQuantity > 0 && balance.quantity <= balance.minQuantity) {
    alerts.push("abaixo_minimo");
  }
  if (balance.quantity > 0 && balance.avgCostCents <= 0) {
    alerts.push("sem_custo");
  }
  return alerts;
}

export const ALERT_LABELS: Record<StockAlert, string> = {
  negativo:
    "Saldo negativo — houve consumo sem entrada registrada. Confira a nota que faltou dar entrada.",
  abaixo_minimo: "Abaixo do mínimo — hora de repor.",
  sem_custo:
    "Tem saldo mas não tem custo: a entrada foi lançada sem valor, e o custo do procedimento sai menor do que é.",
};

export type KitLine = { itemId: string; quantity: number };

/**
 * Quanto o kit custa ao custo médio da unidade.
 *
 * Item sem saldo (nunca comprado) entra como ZERO e é declarado como faltando —
 * apresentar custo incompleto como completo é pior que não apresentar.
 */
export function kitCost(
  lines: KitLine[],
  avgCostByItem: Record<string, number>
): { totalCents: number; missingItemIds: string[] } {
  let total = 0;
  const missing: string[] = [];
  for (const line of lines) {
    const avg = avgCostByItem[line.itemId] ?? 0;
    if (avg <= 0) missing.push(line.itemId);
    total += roundHalfUp(line.quantity * avg);
  }
  return { totalCents: total, missingItemIds: missing };
}

/** Erros que impedem lançar um movimento. Vazio = pode gravar. */
export function movementErrors(input: {
  itemId: string;
  kind: string;
  quantity: number;
  unitCostCents?: number | null;
}): string[] {
  const errors: string[] = [];
  if (!input.itemId) errors.push("Escolha o item.");
  if (!MOVEMENT_KINDS.includes(input.kind as MovementKind)) {
    errors.push("Tipo de movimento inválido.");
  }
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    errors.push("A quantidade precisa ser maior que zero.");
  }
  if (
    input.kind === "entrada" &&
    (input.unitCostCents === null ||
      input.unitCostCents === undefined ||
      input.unitCostCents <= 0)
  ) {
    // Entrada sem valor destrói o custo médio em silêncio: o saldo sobe, o
    // custo cai, e todo procedimento que usa o item passa a parecer barato.
    errors.push("Informe o custo unitário da entrada.");
  }
  return errors;
}
