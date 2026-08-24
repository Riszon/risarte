// COMPRAS C1 — a necessidade da unidade.
//
// O objetivo, nas palavras do dono: "concentrar a compra na franqueadora para
// melhorar a capacidade de negociação". Daí a arquitetura inteira: a NEGOCIAÇÃO
// é da rede, mas o DINHEIRO é da unidade.
//
// A previsão de custo tem TRÊS DEGRAUS e a origem viaja junto com o número —
// sem dizer de onde veio, um preço de dois anos atrás parece tão sólido quanto
// o de ontem. Dinheiro em centavos.

export type EstimateSource =
  | "unidade"
  | "rede"
  | "medio"
  | "manual"
  | "sem_referencia";

export type RequestStatus =
  | "rascunho"
  | "enviada"
  | "em_negociacao"
  | "concluida"
  | "cancelada";

export type PurchaseRequestItem = {
  id: string;
  itemId: string | null;
  description: string;
  accountCode: string | null;
  quantity: number;
  purchaseUnit: string | null;
  estimatedUnitCents: number;
  estimatedTotalCents: number;
  estimateSource: EstimateSource;
  estimateDate: string | null;
  notes: string;
};

export type PurchaseRequest = {
  id: string;
  code: string;
  clinicId: string;
  status: RequestStatus;
  isLocal: boolean;
  notes: string;
  sentAt: string | null;
  createdAt: string;
};

const SOURCE_LABEL: Record<EstimateSource, string> = {
  unidade: "última compra desta unidade",
  rede: "última compra da rede",
  medio: "custo médio atual",
  manual: "informado à mão",
  sem_referencia: "sem referência de preço",
};

export function estimateLabel(source: EstimateSource): string {
  return SOURCE_LABEL[source] ?? source;
}

/** Quanto se confia na previsão — é o que decide a cor na tela. */
export type EstimateTrust = "boa" | "razoavel" | "fraca";

export function estimateTrust(source: EstimateSource): EstimateTrust {
  if (source === "unidade" || source === "manual") return "boa";
  if (source === "rede") return "razoavel";
  return "fraca";
}

/**
 * A previsão está velha?
 *
 * Preço de compra envelhece: seis meses depois ele não é mais referência, é
 * lembrança. A tela avisa em vez de esconder — o mesmo motivo de a origem
 * aparecer junto do número.
 */
export function isEstimateStale(
  estimateDate: string | null,
  today: string,
  maxDays = 180
): boolean {
  if (!estimateDate) return false;
  const d = (iso: string) => {
    const [y, m, dd] = iso.slice(0, 10).split("-").map(Number);
    return Date.UTC(y, (m ?? 1) - 1, dd ?? 1);
  };
  return (d(today) - d(estimateDate)) / 86_400_000 > maxDays;
}

export type RequestTotals = {
  items: number;
  /** Linhas sem preço de referência nenhum. */
  withoutEstimate: number;
  estimatedCents: number;
};

export function requestTotals(items: PurchaseRequestItem[]): RequestTotals {
  return {
    items: items.length,
    withoutEstimate: items.filter(
      (i) => i.estimateSource === "sem_referencia" || i.estimatedUnitCents <= 0
    ).length,
    estimatedCents: items.reduce((s, i) => s + i.estimatedTotalCents, 0),
  };
}

/** O total de uma linha, recalculado ao mexer na quantidade. */
export function lineTotalCents(unitCents: number, quantity: number): number {
  if (unitCents <= 0 || quantity <= 0) return 0;
  return Math.round(unitCents * quantity);
}

export type SendBlock =
  | { can: true }
  | { can: false; reason: "sem_itens" | "ja_enviada" };

/**
 * O que impede enviar — e é curto de propósito.
 *
 * Linha sem preço NÃO impede: a franqueadora vai cotar de qualquer jeito, e
 * exigir previsão para um item que ninguém nunca comprou travaria justamente a
 * primeira compra dele.
 */
export function sendBlock(
  request: Pick<PurchaseRequest, "status">,
  items: PurchaseRequestItem[]
): SendBlock {
  if (request.status !== "rascunho") return { can: false, reason: "ja_enviada" };
  if (items.length === 0) return { can: false, reason: "sem_itens" };
  return { can: true };
}

export function sendBlockMessage(block: SendBlock): string | null {
  if (block.can) return null;
  return block.reason === "sem_itens"
    ? "A lista está vazia — gere pelo estoque ou acrescente um item."
    : "Esta lista já foi enviada à Franqueadora.";
}

const STATUS_LABEL: Record<RequestStatus, string> = {
  rascunho: "Rascunho",
  enviada: "Enviada",
  em_negociacao: "Em negociação",
  concluida: "Concluída",
  cancelada: "Cancelada",
};

export function statusLabel(status: RequestStatus): string {
  return STATUS_LABEL[status] ?? status;
}

// ---------------------------------------------------------------------------
// C2 — A MESA DE NEGOCIAÇÃO DA FRANQUEADORA
// ---------------------------------------------------------------------------
// A rodada é da rede; o pedido é da unidade. Aqui mora só o *item → fornecedor
// → preço*; os pedidos vêm no C3.

export type RoundStatus = "aberta" | "cotando" | "fechada" | "cancelada";

export function roundStatusLabel(status: RoundStatus): string {
  const labels: Record<RoundStatus, string> = {
    aberta: "Aberta",
    cotando: "Em cotação",
    fechada: "Fechada",
    cancelada: "Cancelada",
  };
  return labels[status] ?? status;
}

export type QuotePrice = {
  supplierId: string;
  /** `null` = NÃO COTOU. Nunca zero: zero é um preço e ganharia a comparação. */
  unitCents: number | null;
};

/**
 * A melhor cotação de um item.
 *
 * Quem não cotou não concorre. Tratar "em branco" como zero faria a mesa premiar
 * justamente o fornecedor que não respondeu — e o pedido nasceria sem preço.
 */
export function bestQuote(quotes: QuotePrice[]): QuotePrice | null {
  const valid = quotes.filter(
    (q): q is QuotePrice & { unitCents: number } => q.unitCents !== null
  );
  if (valid.length === 0) return null;
  return valid.reduce((best, q) => (q.unitCents < best.unitCents! ? q : best));
}

export type Share = { key: string; requested: number };

/**
 * O rateio de uma quantidade entre as unidades que pediram.
 *
 * Proporcional ao pedido, truncado, e **a sobra vai para quem mais pediu** —
 * mesma lei da última parcela de venda e da última depreciação. Sem ela,
 * comprar 45 do que 47 foi pedido deixaria fração espalhada e a soma das partes
 * não bateria com o total comprado.
 */
export function allocate(total: number, shares: Share[]): Map<string, number> {
  const result = new Map<string, number>();
  const requestedTotal = shares.reduce((s, x) => s + x.requested, 0);
  if (requestedTotal <= 0 || total <= 0) {
    for (const s of shares) result.set(s.key, 0);
    return result;
  }

  const ordered = [...shares].sort(
    (a, b) => b.requested - a.requested || a.key.localeCompare(b.key)
  );
  let given = 0;
  for (const s of ordered) {
    const base = Math.floor((total * s.requested) / requestedTotal);
    result.set(s.key, base);
    given += base;
  }
  // A sobra dos arredondamentos, para quem mais pediu.
  if (ordered.length > 0) {
    const first = ordered[0].key;
    result.set(first, (result.get(first) ?? 0) + (total - given));
  }
  return result;
}

export type RoundItemSummary = {
  estimatedTotalCents: number;
  awardedTotalCents: number;
  awarded: boolean;
};

export type RoundSavings = {
  estimatedCents: number;
  awardedCents: number;
  /** Positivo = a negociação economizou. */
  savedCents: number;
  percent: number | null;
  itemsAwarded: number;
  itemsPending: number;
};

/**
 * Quanto a negociação conjunta economizou — o número que prova (ou derruba) a
 * decisão de centralizar as compras.
 *
 * Só entram itens JÁ NEGOCIADOS: comparar previsão de item sem cotação contra
 * zero mostraria uma economia de 100% que não existe.
 */
export function roundSavings(items: RoundItemSummary[]): RoundSavings {
  const awarded = items.filter((i) => i.awarded);
  const estimatedCents = awarded.reduce((s, i) => s + i.estimatedTotalCents, 0);
  const awardedCents = awarded.reduce((s, i) => s + i.awardedTotalCents, 0);
  const savedCents = estimatedCents - awardedCents;
  return {
    estimatedCents,
    awardedCents,
    savedCents,
    percent: estimatedCents > 0 ? savedCents / estimatedCents : null,
    itemsAwarded: awarded.length,
    itemsPending: items.length - awarded.length,
  };
}

// ---------------------------------------------------------------------------
// C3b — O RECEBIMENTO
// ---------------------------------------------------------------------------

export type OrderStatus =
  | "aberto"
  | "recebido_parcial"
  | "recebido"
  | "cancelado";

export function orderStatusLabel(status: OrderStatus): string {
  const map: Record<OrderStatus, string> = {
    aberto: "Aguardando entrega",
    recebido_parcial: "Recebido em parte",
    recebido: "Recebido",
    cancelado: "Cancelado",
  };
  return map[status] ?? status;
}

export type ReceiptLine = {
  orderItemId: string;
  description: string;
  orderedQuantity: number;
  alreadyReceived: number;
  /** O que está chegando agora. */
  quantity: number;
  orderedUnitCents: number;
  /** O preço da NOTA. Nulo = usar o do pedido. */
  invoicedUnitCents: number | null;
};

/** O que ainda falta chegar desta linha. Nunca negativo. */
export function pendingQuantity(line: {
  orderedQuantity: number;
  alreadyReceived: number;
}): number {
  return Math.max(0, line.orderedQuantity - line.alreadyReceived);
}

/**
 * A diferença de preço desta linha, com sinal.
 *
 * Positivo = a nota cobrou MAIS que o combinado. É o número que a franqueadora
 * leva para a próxima negociação — e o motivo de o preço do pedido ficar
 * congelado no recebimento: corrigir o pedido depois apagaria a evidência.
 */
export function priceDiffCents(line: ReceiptLine): number {
  const invoiced = line.invoicedUnitCents ?? line.orderedUnitCents;
  return Math.round(line.quantity * (invoiced - line.orderedUnitCents));
}

export type ReceiptTotals = {
  itemsCents: number;
  priceDiffCents: number;
  /** Linhas em que veio quantidade diferente da que faltava. */
  quantityDivergences: number;
};

export function receiptTotals(lines: ReceiptLine[]): ReceiptTotals {
  const active = lines.filter((l) => l.quantity > 0);
  return {
    itemsCents: active.reduce(
      (s, l) =>
        s + Math.round(l.quantity * (l.invoicedUnitCents ?? l.orderedUnitCents)),
      0
    ),
    priceDiffCents: active.reduce((s, l) => s + priceDiffCents(l), 0),
    quantityDivergences: active.filter(
      (l) => l.quantity !== pendingQuantity(l)
    ).length,
  };
}

/**
 * O pedido fica RECEBIDO só quando nada mais falta.
 *
 * Quantidade a mais não "compensa" outra linha: veio 12 de um item e faltaram 2
 * de outro, o pedido continua em aberto. Compensar esconderia a pendência com o
 * fornecedor justamente onde ela precisa aparecer.
 */
export function orderStatusAfter(
  lines: { orderedQuantity: number; alreadyReceived: number }[]
): OrderStatus {
  const pending = lines.reduce((s, l) => s + pendingQuantity(l), 0);
  const received = lines.reduce((s, l) => s + l.alreadyReceived, 0);
  if (pending <= 0) return "recebido";
  return received > 0 ? "recebido_parcial" : "aberto";
}

/** As parcelas propostas para a conta a pagar do recebimento. */
export function suggestInstallments(
  totalCents: number,
  count: number,
  firstDueDate: string
): { amountCents: number; dueDate: string }[] {
  const n = Math.max(1, Math.round(count));
  if (totalCents <= 0) return [];
  const base = Math.floor(totalCents / n);
  const out: { amountCents: number; dueDate: string }[] = [];
  for (let i = 0; i < n; i++) {
    // A ÚLTIMA absorve o resíduo — mesma lei das parcelas de venda e da
    // depreciação. Sem ela sobrariam centavos órfãos na conta a pagar.
    const amountCents = i === n - 1 ? totalCents - base * (n - 1) : base;
    out.push({ amountCents, dueDate: addMonthsISO(firstDueDate, i) });
  }
  return out;
}

function addMonthsISO(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const base = new Date(Date.UTC(y, (m ?? 1) - 1 + months, 1));
  const last = new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)
  ).getUTCDate();
  base.setUTCDate(Math.min(d ?? 1, last));
  return base.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// C4 — O DASHBOARD
// ---------------------------------------------------------------------------

export type SavingsRow = {
  roundId: string;
  roundCode: string;
  roundName: string;
  closedAt: string | null;
  itemsAwarded: number;
  itemsPending: number;
  estimatedCents: number;
  awardedCents: number;
  savedCents: number;
};

export type SavingsTotals = {
  estimatedCents: number;
  awardedCents: number;
  savedCents: number;
  /** Fração sobre a previsão. `null` quando não há previsão para comparar. */
  percent: number | null;
  rounds: number;
  itemsPending: number;
};

/**
 * A economia acumulada da negociação conjunta.
 *
 * **É contra a PREVISÃO, não contra a realidade.** Se a previsão estava velha,
 * a economia parece maior do que foi — e a tela precisa dizer isso. Apresentar
 * este número como dinheiro medido seria provar a tese com a régua da própria
 * tese.
 */
export function savingsTotals(rows: SavingsRow[]): SavingsTotals {
  const estimatedCents = rows.reduce((s, r) => s + r.estimatedCents, 0);
  const awardedCents = rows.reduce((s, r) => s + r.awardedCents, 0);
  const savedCents = estimatedCents - awardedCents;
  return {
    estimatedCents,
    awardedCents,
    savedCents,
    percent: estimatedCents > 0 ? savedCents / estimatedCents : null,
    rounds: rows.length,
    itemsPending: rows.reduce((s, r) => s + r.itemsPending, 0),
  };
}

export type LeakageRow = {
  clinicId: string;
  clinicName: string;
  networkCents: number;
  localCents: number;
  localPurchases: number;
  declaredLocalRequests: number;
};

/**
 * A fração comprada por fora da rede.
 *
 * `null` quando não houve compra nenhuma no período: zero dividido por zero não
 * é "0% de vazamento", é ausência de informação — e mostrar 0% faria uma
 * unidade sem compras parecer exemplar.
 */
export function leakagePercent(row: LeakageRow): number | null {
  const total = row.networkCents + row.localCents;
  if (total <= 0) return null;
  return row.localCents / total;
}

export type LeakageTotals = {
  networkCents: number;
  localCents: number;
  percent: number | null;
  /** Unidades que compraram por fora no período. */
  clinicsLeaking: number;
};

export function leakageTotals(rows: LeakageRow[]): LeakageTotals {
  const networkCents = rows.reduce((s, r) => s + r.networkCents, 0);
  const localCents = rows.reduce((s, r) => s + r.localCents, 0);
  const total = networkCents + localCents;
  return {
    networkCents,
    localCents,
    percent: total > 0 ? localCents / total : null,
    clinicsLeaking: rows.filter((r) => r.localCents > 0).length,
  };
}

export type SupplierRow = {
  supplierId: string | null;
  supplierName: string;
  orders: number;
  orderedCents: number;
  receivedCents: number;
  priceDiffCents: number;
  avgDeliveryDays: number | null;
};

/**
 * O fornecedor entregou tudo o que foi pedido?
 *
 * Compara o valor recebido com o pedido. Fica `null` enquanto nada chegou —
 * "0% entregue" e "ainda não entregou" são coisas diferentes, e o pedido feito
 * ontem não é um fornecedor ruim.
 */
export function deliveryRate(row: SupplierRow): number | null {
  if (row.orderedCents <= 0) return null;
  if (row.receivedCents <= 0) return null;
  return row.receivedCents / row.orderedCents;
}
