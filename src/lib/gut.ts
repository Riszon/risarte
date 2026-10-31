// Matriz GUT (Gravidade × Urgência × Tendência) — prioridade de execução de cada
// procedimento do plano. Cada nota vai de 1 a 5; a prioridade é o produto G×U×T
// (1..125). Serve ao Comercial (o que priorizar numa negociação) e à execução na
// unidade (onde focar). Lógica central, reutilizável em telas e servidor.

export type GutTier = "high" | "medium" | "low";

/** Notas GUT de um item (qualquer objeto com os três campos opcionais). */
export type GutInput = {
  gutGravity?: number | null;
  gutUrgency?: number | null;
  gutTendency?: number | null;
};

/** Rótulos das três dimensões (para os seletores 1..5). */
export const GUT_DIMENSION_LABELS = {
  gravity: "Gravidade",
  urgency: "Urgência",
  tendency: "Tendência",
} as const;

/** Rótulo pt-BR de cada faixa de prioridade. */
export const GUT_TIER_LABELS: Record<GutTier, string> = {
  high: "Alta",
  medium: "Média",
  low: "Baixa",
};

/** Um clique na faixa preenche as três notas (cada uma cai na própria faixa). */
export const GUT_PRESETS: Record<GutTier, { gravity: number; urgency: number; tendency: number }> = {
  high: { gravity: 4, urgency: 4, tendency: 4 },
  medium: { gravity: 3, urgency: 3, tendency: 3 },
  low: { gravity: 2, urgency: 2, tendency: 2 },
};

/**
 * Prioridade = G × U × T. Só existe quando as três notas estão definidas (1..5);
 * se qualquer uma faltar, devolve null (item "sem prioridade").
 */
export function gutScore(item: GutInput): number | null {
  const g = item.gutGravity;
  const u = item.gutUrgency;
  const t = item.gutTendency;
  if (!g || !u || !t) return null;
  return g * u * t;
}

/**
 * Faixa da prioridade a partir do produto GUT. Cortes: Alta ≥ 45, Média 18–44,
 * Baixa 1–17 (ajustáveis num único lugar). null quando não há prioridade.
 */
export function gutTier(score: number | null): GutTier | null {
  if (score == null) return null;
  if (score >= 45) return "high";
  if (score >= 18) return "medium";
  return "low";
}

/** Atalho: faixa direto do item. */
export function gutTierOf(item: GutInput): GutTier | null {
  return gutTier(gutScore(item));
}

/**
 * As notas depois de um clique na faixa. Quem já está nela guarda as notas
 * ajustadas: clicar em "Alta" num 3·4·4 confirma, não troca por 4·4·4.
 */
export function notasDaFaixa(
  atual: GutInput,
  faixa: GutTier
): { gutGravity: number; gutUrgency: number; gutTendency: number } {
  if (gutTierOf(atual) === faixa) {
    return {
      gutGravity: atual.gutGravity!,
      gutUrgency: atual.gutUrgency!,
      gutTendency: atual.gutTendency!,
    };
  }
  const p = GUT_PRESETS[faixa];
  return { gutGravity: p.gravity, gutUrgency: p.urgency, gutTendency: p.tendency };
}

/** Item do plano, para repetir a prioridade entre os procedimentos iguais. */
export type ItemComPrioridade = GutInput & {
  id: string;
  procedureId: string | null;
  gutRepeated?: boolean;
};

/**
 * O que o clique faz no plano: o item recebe as notas e os iguais sem nota, ou com
 * nota ainda repetida, acompanham. Nota dada pelo Planner nunca é sobrescrita. É a
 * mesma regra de `set_plan_item_priority` (0339): mudou uma, muda a outra.
 */
export function aplicarPrioridade<T extends ItemComPrioridade>(
  itens: readonly T[],
  itemId: string,
  notas: { gutGravity: number; gutUrgency: number; gutTendency: number }
): T[] {
  const origem = itens.find((i) => i.id === itemId);
  if (!origem) return [...itens];
  return itens.map((i) => {
    if (i.id === itemId) return { ...i, ...notas, gutRepeated: false };
    const igual = origem.procedureId != null && i.procedureId === origem.procedureId;
    if (igual && (i.gutRepeated || gutScore(i) == null)) {
      return { ...i, ...notas, gutRepeated: true };
    }
    return i;
  });
}

/**
 * Prioridade média de um conjunto de procedimentos: média das pontuações dos
 * itens que TÊM prioridade (ignora os sem nota). Devolve a média arredondada + a
 * faixa; null quando nenhum item tem prioridade.
 */
export function gutAverage(
  items: GutInput[]
): { avg: number; tier: GutTier; count: number } | null {
  const scores = items
    .map(gutScore)
    .filter((s): s is number => s != null);
  if (scores.length === 0) return null;
  const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  return { avg, tier: gutTier(avg)!, count: scores.length };
}

/**
 * Ordena por prioridade (maior no topo). Itens sem prioridade vão para o fim,
 * mantendo a ordem original entre si (sort estável).
 */
export function sortByGutDesc<T extends GutInput>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const sa = gutScore(a);
    const sb = gutScore(b);
    if (sa == null && sb == null) return 0;
    if (sa == null) return 1;
    if (sb == null) return -1;
    return sb - sa;
  });
}
