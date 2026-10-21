// OD4 (G2): o orçamento impresso tem validade. Puro — testável sem banco.

/** Combinado com o dono (20/10/2026): sem regra configurada, vale 15 dias. */
export const VALIDADE_PADRAO_DIAS = 15;

export type LinhaDeValidade = {
  clinic_id: string | null;
  budget_validity_days: number | null;
};

/** Cascata das regras comerciais: a unidade vence a rede; sem nenhuma, 15. */
export function validadeDoOrcamento(
  linhas: LinhaDeValidade[],
  clinicId: string
): number {
  const unidade = linhas.find((l) => l.clinic_id === clinicId)?.budget_validity_days;
  const rede = linhas.find((l) => l.clinic_id === null)?.budget_validity_days;
  const dias = unidade ?? rede ?? VALIDADE_PADRAO_DIAS;
  return Number.isInteger(dias) && dias >= 1 ? dias : VALIDADE_PADRAO_DIAS;
}

export type ItemDoOrcamento = {
  id: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  /** J7: benefício do programa neste item (gravado no salvamento). */
  programDiscountCents: number;
  plannedSessions: number | null;
  included: boolean;
};

/**
 * Os números do orçamento a partir do que está SALVO na negociação. O total é
 * o do banco (`final_cents`, recalculado pela regra comercial a cada
 * salvamento) — a tela não refaz a conta da regra; ela só mostra de onde ele
 * vem: subtotal do que entrou − benefício do programa + ajuste.
 */
export function numerosDoOrcamento<T extends ItemDoOrcamento>(
  itens: T[],
  negociacao: { adjustmentCents: number; finalCents: number }
) {
  const incluidos = itens.filter((i) => i.included);
  const excluidos = itens.filter((i) => !i.included);
  const subtotalCents = incluidos.reduce((s, i) => s + i.quantity * i.unitPriceCents, 0);
  const beneficioCents = incluidos.reduce((s, i) => s + i.programDiscountCents, 0);
  // A mesma conta do banco (0182): final = máx(0, subtotal − benefício + ajuste).
  const contaCents = Math.max(0, subtotalCents - beneficioCents + negociacao.adjustmentCents);
  return {
    incluidos,
    excluidos,
    subtotalCents,
    beneficioCents,
    descontoCents: negociacao.adjustmentCents,
    totalCents: negociacao.finalCents,
    /** A conta da tela fecha com o total salvo? Se não, a negociação mudou
     *  depois do último salvamento (ou um item saiu do plano): o orçamento
     *  avisa em vez de imprimir dois números que não batem. */
    bate: contaCents === negociacao.finalCents,
  };
}

/** "AAAA-MM-DD" + N dias, em data de calendário (sem fuso no meio). */
export function somarDias(isoDia: string, dias: number): string {
  const [a, m, d] = isoDia.split("-").map(Number);
  const t = new Date(Date.UTC(a, m - 1, d + dias));
  return t.toISOString().slice(0, 10);
}

/** "AAAA-MM-DD" → "DD/MM/AAAA". */
export function diaBr(isoDia: string): string {
  const [a, m, d] = isoDia.split("-");
  return `${d}/${m}/${a}`;
}
