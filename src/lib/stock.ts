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

// -----------------------------------------------------------------------------
// UNIDADES — listas fechadas, não texto livre (0214)
// -----------------------------------------------------------------------------
// Com campo livre, "un", "und", "UN" e "unid" viram quatro itens diferentes no
// consolidado da rede, e ninguém descobre isso até o relatório sair errado.

/** Em que se COMPRA. Só serve para lançar a entrada como está na nota. */
export const PURCHASE_UNITS = [
  "unidade",
  "caixa",
  "pacote",
  "frasco",
  "tubo",
  "bisnaga",
  "galão",
  "rolo",
  "kit",
  "envelope",
] as const;

/** Em que se CONSOME — é nela que o saldo vive e o kit fala. */
export const STOCK_UNITS = [
  "unidade",
  "grama",
  "mililitro",
  "aplicação",
  "folha",
  "par",
  "metro",
] as const;

export type PurchaseUnit = (typeof PURCHASE_UNITS)[number];
export type StockUnit = (typeof STOCK_UNITS)[number];

/** Abreviação para caber nas listas sem virar sopa de letras. */
export const UNIT_SHORT: Record<string, string> = {
  unidade: "un",
  grama: "g",
  mililitro: "ml",
  aplicação: "apl",
  folha: "fl",
  par: "par",
  metro: "m",
  caixa: "cx",
  pacote: "pct",
  frasco: "fr",
  tubo: "tb",
  bisnaga: "bg",
  galão: "gl",
  rolo: "rl",
  kit: "kit",
  envelope: "env",
};

export function unitShort(unit: string): string {
  return UNIT_SHORT[unit] ?? unit;
}

/**
 * O custo de UMA unidade de consumo, a partir do preço da embalagem.
 *
 * É o cálculo que faltava: uma caixa de sugadores de R$ 25,00 com 100 unidades
 * custa 25 centavos por sugador, não R$ 25,00. Sem ele, o material do
 * procedimento saía 100 vezes maior — e em silêncio, porque nada na tela
 * apontava o motivo.
 *
 * Devolve centavos COM decimais de propósito: R$ 180,00 ÷ 7 g = 2571,4286
 * centavos por grama, e arredondar a cada movimento subestimaria o custo sempre
 * para o mesmo lado. Taxa carrega decimais; valor vira centavo inteiro só no
 * total.
 */
export function unitCostFromPackage(
  packageCostCents: number,
  unitsPerPackage: number
): number {
  const factor = unitsPerPackage > 0 ? unitsPerPackage : 1;
  return packageCostCents / factor;
}

/** Quantas unidades de consumo entram ao comprar N embalagens. */
export function unitsFromPackages(
  packages: number,
  unitsPerPackage: number
): number {
  const factor = unitsPerPackage > 0 ? unitsPerPackage : 1;
  return packages * factor;
}

/** Como a conversão é lida na tela: "1 caixa = 100 un a R$ 0,25". */
export function conversionSummary(input: {
  packages: number;
  packageUnit: string;
  packageCostCents: number;
  unitsPerPackage: number;
  stockUnit: string;
}): { units: number; unitCostCents: number } {
  return {
    units: unitsFromPackages(input.packages, input.unitsPerPackage),
    unitCostCents: unitCostFromPackage(
      input.packageCostCents,
      input.unitsPerPackage
    ),
  };
}

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
  /** 0222: acima disto é dinheiro parado. Nulo = sem controle de máximo. */
  maxQuantity?: number | null;
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
  if (currentQty <= 0 || newQty <= 0) return rate(Math.max(0, inCostCents));
  return rate((currentQty * currentAvgCents + inQty * inCostCents) / newQty);
}

/**
 * Custo unitário guarda 4 casas; valor total vira centavo inteiro.
 *
 * R$ 180,00 ÷ 7 g dá 2571,4286 centavos por grama. Arredondar isso para 2571 a
 * cada movimento subestimaria o custo sempre para o mesmo lado — pouco por vez,
 * e sempre a favor do mesmo erro.
 */
function rate(value: number): number {
  return Math.round(value * 10000) / 10000;
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
    const unit = Math.max(0, movement.unitCostCents ?? balance.avgCostCents);
    const avg = weightedAverage(balance.quantity, balance.avgCostCents, qty, unit);
    return {
      balance: {
        ...balance,
        quantity: balance.quantity + qty,
        avgCostCents: avg,
      },
      unitCostCents: rate(unit),
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

export type StockAlert =
  | "negativo"
  | "abaixo_minimo"
  | "acima_maximo"
  | "sem_custo";

/**
 * O que está errado neste saldo. Ordem importa: negativo é mais grave que
 * abaixo do mínimo, e é o único que denuncia consumo sem entrada.
 */
export function balanceAlerts(balance: Balance): StockAlert[] {
  const alerts: StockAlert[] = [];
  if (balance.quantity < 0) alerts.push("negativo");
  else if (balance.minQuantity > 0 && balance.quantity <= balance.minQuantity) {
    alerts.push("abaixo_minimo");
  } else if (
    balance.maxQuantity != null &&
    balance.maxQuantity > 0 &&
    balance.quantity > balance.maxQuantity
  ) {
    // 0222: falta é o alerta óbvio; sobra é o que ninguém olha. Acima do
    // máximo é dinheiro parado — e, em material com validade, perda marcada
    // para acontecer.
    alerts.push("acima_maximo");
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
  acima_maximo:
    "Acima do máximo — dinheiro parado na prateleira, e risco de vencer antes de usar.",
  sem_custo:
    "Tem saldo mas não tem custo: a entrada foi lançada sem valor, e o custo do procedimento sai menor do que é.",
};

/**
 * 0222 — o inventário.
 *
 * A DIFERENÇA É A INFORMAÇÃO, não um erro a apagar: ela mede perda, furto, kit
 * mal cadastrado e consumo fora do previsto.
 *
 * E o ajuste sai contra o ESPERADO CONGELADO no momento da contagem, não contra
 * o saldo de agora. Entre contar a gaveta e aplicar a contagem pode ter havido
 * um atendimento — se o ajuste fosse "deixe o saldo igual ao contado", ele
 * apagaria esse consumo legítimo.
 */
export type CountLine = {
  itemId: string;
  expectedQuantity: number;
  countedQuantity: number | null;
  avgCostCents: number;
};

export type CountSummary = {
  counted: number;
  pending: number;
  matching: number;
  differences: number;
  /** Valor das sobras encontradas (positivo). */
  surplusCents: number;
  /** Valor das faltas (positivo, para leitura). */
  shortageCents: number;
  netCents: number;
};

export function summarizeCount(lines: CountLine[]): CountSummary {
  let counted = 0;
  let pending = 0;
  let matching = 0;
  let differences = 0;
  let surplus = 0;
  let shortage = 0;

  for (const l of lines) {
    if (l.countedQuantity === null) {
      pending += 1;
      continue;
    }
    counted += 1;
    const diff = l.countedQuantity - l.expectedQuantity;
    if (diff === 0) {
      matching += 1;
      continue;
    }
    differences += 1;
    const value = roundHalfUp(Math.abs(diff) * l.avgCostCents);
    if (diff > 0) surplus += value;
    else shortage += value;
  }

  return {
    counted,
    pending,
    matching,
    differences,
    surplusCents: surplus,
    shortageCents: shortage,
    netCents: surplus - shortage,
  };
}

/**
 * Quanto comprar, em EMBALAGENS.
 *
 * Comprar é em caixa, não em unidade — e arredonda para CIMA, porque meia caixa
 * não existe e faltar custa mais que sobrar um pouco. Sem máximo definido, o
 * alvo é o dobro do mínimo: repor até o mínimo deixaria o item em alerta no dia
 * seguinte.
 */
export function suggestedPackages(input: {
  total: number;
  minQuantity: number;
  maxQuantity: number | null;
  unitsPerPurchase: number;
}): number {
  const target =
    input.maxQuantity != null && input.maxQuantity > 0
      ? input.maxQuantity
      : input.minQuantity * 2;
  const missing = target - input.total;
  if (missing <= 0) return 0;
  return Math.ceil(missing / Math.max(input.unitsPerPurchase || 1, 0.000001));
}

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
