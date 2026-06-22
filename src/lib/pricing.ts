// Shared types/helpers for the price table (cascade) and the plan budget.
// Money is stored and handled in CENTS (integer) to avoid float rounding.

export type Procedure = {
  id: string;
  code: string | null;
  name: string;
  category: string | null;
  defaultPriceCents: number;
  isActive: boolean;
};

export type UnitPrice = {
  procedureId: string;
  priceCents: number;
};

/** A procedure with the effective price for a given clinic (override > default). */
export type PricedProcedure = Procedure & { effectivePriceCents: number };

export type BudgetItem = {
  id: string;
  procedureId: string | null;
  description: string;
  quantity: number;
  unitPriceCents: number;
};

/** Merge the catalog with a unit's overrides into effective prices. */
export function resolveProcedurePrices(
  procedures: Procedure[],
  overrides: UnitPrice[]
): PricedProcedure[] {
  const overrideByProc = new Map(overrides.map((o) => [o.procedureId, o.priceCents]));
  return procedures.map((p) => ({
    ...p,
    effectivePriceCents: overrideByProc.get(p.id) ?? p.defaultPriceCents,
  }));
}

export function budgetTotalCents(items: BudgetItem[]): number {
  return items.reduce((sum, i) => sum + i.quantity * i.unitPriceCents, 0);
}

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function formatBRL(cents: number): string {
  return BRL.format((cents || 0) / 100);
}

/**
 * Parses a pt-BR money string ("1.234,56", "R$ 80,00", "80") into cents.
 * Returns null when the input is not a valid number.
 */
export function parseBRLToCents(input: string): number | null {
  const cleaned = input
    .replace(/[R$\s]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  if (cleaned === "") return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}
