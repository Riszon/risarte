import "server-only";
import {
  loadClientProgram,
  type ClientProgram,
  type ProgramBenefit,
} from "@/lib/empresarial/benefits";
import { loadPprProgram, type PprProgram } from "@/lib/ppr/benefits";

/**
 * Camada única de PROGRAMAS do cliente (Risarte Empresarial + PPR+).
 *
 * Decisão do dono (docs/PPR.md §14, item 4): quando o cliente está nos dois,
 * vale o MELHOR benefício para ele, procedimento a procedimento — nunca a soma.
 * O orçamento e a venda direta consultam só esta camada.
 */
export type ClientPrograms = ClientProgram & {
  /** PPR+ resolvido (condições de pagamento do plano vêm daqui). */
  ppr: PprProgram | null;
  /** De qual programa saiu o benefício de cada procedimento. */
  sourceByProcedure: Record<string, "ppr" | "empresarial">;
  /** Nome curto para mostrar na tela ("PPR+ Plano Família", "Empresarial X"). */
  label: string | null;
};

/** Quanto "vale" uma oferta, para escolher a melhor. Isento ganha de tudo. */
function rank(b: ProgramBenefit | null): number {
  if (!b || b.benefitType === "NOT_COVERED") return -1;
  if (!b.available) return 0;
  if (b.benefitType === "FREE") return 1000;
  if (b.benefitType === "DISCOUNT_PERCENT") return Math.max(0, b.benefitValue ?? 0);
  // DISCOUNT_AMOUNT não é comparável a % sem o preço; fica acima de 0 e abaixo
  // de um desconto percentual alto, e o desempate manda no PPR+ (o cliente paga
  // por ele do próprio bolso).
  return 1;
}

export async function loadClientPrograms(
  clientId: string
): Promise<ClientPrograms> {
  const [empresarial, ppr] = await Promise.all([
    loadClientProgram(clientId),
    loadPprProgram(clientId),
  ]);

  const byProcedure: Record<string, ProgramBenefit> = {};
  const sourceByProcedure: Record<string, "ppr" | "empresarial"> = {};

  const pprBenefits: Record<string, ProgramBenefit> = {};
  for (const [id, b] of Object.entries(ppr.byProcedure)) {
    pprBenefits[id] = {
      procedureId: id,
      benefitType: b.benefitType,
      benefitValue: b.benefitValue,
      available: b.available,
      blockedReason: b.blockedReason,
    };
  }

  const ids = new Set([
    ...Object.keys(empresarial.byProcedure),
    ...Object.keys(pprBenefits),
  ]);
  for (const id of ids) {
    const emp = empresarial.byProcedure[id] ?? null;
    const p = pprBenefits[id] ?? null;
    // Empate fica com o PPR+ (item 4 da decisão).
    const pprWins = rank(p) >= rank(emp);
    const chosen = pprWins ? p : emp;
    if (!chosen) continue;
    byProcedure[id] = chosen;
    sourceByProcedure[id] = pprWins ? "ppr" : "empresarial";
  }

  const label = ppr.membershipId
    ? `PPR+ ${ppr.planName ?? ""}`.trim()
    : empresarial.active
      ? `Risarte Empresarial${empresarial.companyName ? ` · ${empresarial.companyName}` : ""}`
      : null;

  return {
    active: empresarial.active || ppr.active,
    companyId: empresarial.companyId,
    companyName: empresarial.companyName,
    byProcedure,
    ppr: ppr.membershipId ? ppr : null,
    sourceByProcedure,
    label,
  };
}
