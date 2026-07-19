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
