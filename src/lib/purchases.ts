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
