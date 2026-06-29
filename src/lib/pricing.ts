// Shared types/helpers for the procedures catalog (cascade) and the plan budget.
// Money is stored and handled in CENTS (integer) to avoid float rounding.

import type { MethodologyPillar } from "@/lib/journey";

export type Procedure = {
  id: string;
  /** Internal code (auto-generated, e.g. PRC-00001). */
  code: string | null;
  tussCode: string | null;
  name: string;
  specialty: string | null;
  defaultPriceCents: number;
  minPriceCents: number | null;
  maxPriceCents: number | null;
  /** Commission as a percentage of the procedure price (realized on completion). */
  commissionPercent: number;
  /** Fixed commission in cents (realized on completion). */
  commissionFixedCents: number;
  pillar: MethodologyPillar | null;
  /** Estimated execution time in minutes (null = not set). */
  estimatedMinutes: number | null;
  isActive: boolean;
};

export type UnitPrice = {
  procedureId: string;
  priceCents: number;
};

/** One session of a procedure's protocol (name + estimated minutes). */
export type ProcedureSession = {
  id: string;
  procedureId: string;
  clinicId: string | null; // null = protocolo da Rede; preenchido = da unidade
  sessionIndex: number;
  name: string | null;
  estimatedMinutes: number;
};

/** Time options for the 15-minute selector (15 min … 4 h). */
export const SESSION_TIME_OPTIONS = Array.from(
  { length: 16 },
  (_, i) => (i + 1) * 15
);

export function protocolTotalMinutes(sessions: { minutes: number }[]): number {
  return sessions.reduce((sum, s) => sum + (s.minutes || 0), 0);
}

/** Human label for a minutes amount, e.g. 90 → "1h30". */
export function formatMinutes(min: number): string {
  if (!min) return "0 min";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

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
