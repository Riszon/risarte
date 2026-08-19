// FIN7.1/7.2 — ORÇAMENTO E ORÇADO × REALIZADO.
//
// O sistema responde o que ACONTECEU. O orçamento acrescenta o que DEVERIA ter
// acontecido — a diferença entre descobrir no dia 30 que o marketing estourou e
// ser avisado no dia 12.
//
// UMA REGRA SÓ DE SINAL. A meta é guardada com o mesmo sinal do realizado
// (receita positiva, despesa negativa), então `realizado − orçado` positivo
// significa SEMPRE "melhor que o previsto": receita acima da meta dá positivo, e
// despesa de 4.000 contra meta de 5.000 também. A alternativa seria uma tabela
// de "nesta conta subir é bom, naquela é ruim" — a mesma que a DRE não precisou.

export type BudgetBlock =
  | "receita_bruta"
  | "deducoes"
  | "custos_diretos"
  | "despesas_operacionais"
  | "resultado_financeiro"
  | "depreciacao"
  | "fora";

export type BudgetRow = {
  accountCode: string;
  accountName: string;
  block: BudgetBlock;
  budgetCents: number;
  actualCents: number;
  ytdBudgetCents: number;
  ytdActualCents: number;
};

export type VarianceStatus =
  | "sem_meta"
  | "melhor"
  | "no_alvo"
  | "atencao"
  | "estourou";

export type Variance = {
  /** Realizado − orçado. Positivo = melhor que o previsto, sempre. */
  deltaCents: number;
  /** Fração sobre a meta. `null` quando não há meta para comparar. */
  percent: number | null;
  status: VarianceStatus;
};

/**
 * A variação e o farol.
 *
 * `tolerance` é a folga (fração) dentro da qual o mês está "no alvo" — orçamento
 * acertado no centavo não existe, e farol que acende com 1% de diferença é
 * farol que ninguém olha. Acima do dobro da folga vira "estourou".
 */
export function variance(
  actualCents: number,
  budgetCents: number,
  tolerance = 0.05
): Variance {
  const deltaCents = Math.round(actualCents - budgetCents);
  if (budgetCents === 0) {
    return { deltaCents, percent: null, status: "sem_meta" };
  }
  const percent = deltaCents / Math.abs(budgetCents);
  const off = Math.abs(percent);

  if (off <= tolerance) return { deltaCents, percent, status: "no_alvo" };
  if (deltaCents > 0) return { deltaCents, percent, status: "melhor" };
  return {
    deltaCents,
    percent,
    status: off > tolerance * 2 ? "estourou" : "atencao",
  };
}

export type BudgetSection = {
  block: BudgetBlock;
  label: string;
  rows: BudgetRow[];
  budgetCents: number;
  actualCents: number;
  ytdBudgetCents: number;
  ytdActualCents: number;
};

export type BudgetReport = {
  sections: BudgetSection[];
  budgetCents: number;
  actualCents: number;
  ytdBudgetCents: number;
  ytdActualCents: number;
  /** Resultado previsto e realizado: a soma de tudo, com o sinal de cada conta. */
  resultBudgetCents: number;
  resultActualCents: number;
};

const BLOCK_ORDER: BudgetBlock[] = [
  "receita_bruta",
  "deducoes",
  "custos_diretos",
  "despesas_operacionais",
  "resultado_financeiro",
  "depreciacao",
];

const BLOCK_LABELS: Record<BudgetBlock, string> = {
  receita_bruta: "Receita bruta",
  deducoes: "Deduções",
  custos_diretos: "Custos diretos",
  despesas_operacionais: "Despesas operacionais",
  resultado_financeiro: "Resultado financeiro",
  depreciacao: "Depreciação",
  fora: "Fora do resultado",
};

export function buildBudgetReport(rows: BudgetRow[]): BudgetReport {
  const sections: BudgetSection[] = [];

  for (const block of BLOCK_ORDER) {
    const inBlock = rows.filter((r) => r.block === block);
    if (inBlock.length === 0) continue;
    sections.push({
      block,
      label: BLOCK_LABELS[block],
      rows: [...inBlock].sort((a, b) =>
        a.accountCode.localeCompare(b.accountCode)
      ),
      budgetCents: inBlock.reduce((s, r) => s + r.budgetCents, 0),
      actualCents: inBlock.reduce((s, r) => s + r.actualCents, 0),
      ytdBudgetCents: inBlock.reduce((s, r) => s + r.ytdBudgetCents, 0),
      ytdActualCents: inBlock.reduce((s, r) => s + r.ytdActualCents, 0),
    });
  }

  const sum = (pick: (s: BudgetSection) => number) =>
    sections.reduce((t, s) => t + pick(s), 0);

  return {
    sections,
    budgetCents: sum((s) => s.budgetCents),
    actualCents: sum((s) => s.actualCents),
    ytdBudgetCents: sum((s) => s.ytdBudgetCents),
    ytdActualCents: sum((s) => s.ytdActualCents),
    resultBudgetCents: sum((s) => s.budgetCents),
    resultActualCents: sum((s) => s.actualCents),
  };
}

/** Rótulo do bloco, para a tela. */
export function blockLabel(block: BudgetBlock): string {
  return BLOCK_LABELS[block];
}

/**
 * O sinal da conta — a mesma regra do banco (`budget_sign`).
 *
 * A tela mostra e recebe número positivo; o sinal é aplicado numa regra só,
 * dos dois lados, para os dois nunca discordarem.
 */
export function budgetSign(accountCode: string): 1 | -1 {
  if (accountCode.startsWith("1.9")) return -1;
  if (accountCode.startsWith("1")) return 1;
  return -1;
}

/**
 * Quanto do ano já passou, em fração — a régua honesta para o acumulado.
 *
 * Comparar o acumulado de março contra a meta do ano inteiro diria que tudo
 * está 75% abaixo do orçado. O que importa é o acumulado contra a meta ATÉ
 * março, que é o que `budget_vs_actual` devolve.
 */
export function yearProgress(month: number): number {
  const m = Math.min(12, Math.max(1, Math.round(month)));
  return m / 12;
}
