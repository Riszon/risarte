import {
  GUT_TIER_LABELS,
  gutAverage,
  gutScore,
  gutTier,
  type GutInput,
} from "@/lib/gut";
import { cn } from "@/lib/utils";

const TIER_CLASS = {
  high: "border-red-200 bg-red-100 text-red-700",
  medium: "border-amber-200 bg-amber-100 text-amber-700",
  low: "border-emerald-200 bg-emerald-100 text-emerald-700",
} as const;

/**
 * Selo de prioridade GUT de um procedimento — faixa colorida (Alta/Média/Baixa)
 * com o número da prioridade ao lado (ex.: "Alta · 80"). Não renderiza nada se
 * o item não tiver as três notas definidas.
 */
export function GutBadge({
  item,
  className,
}: {
  item: GutInput;
  className?: string;
}) {
  const score = gutScore(item);
  const tier = gutTier(score);
  if (score == null || tier == null) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-medium leading-none",
        TIER_CLASS[tier],
        className
      )}
      title={`Prioridade GUT ${GUT_TIER_LABELS[tier]} (Gravidade × Urgência × Tendência = ${score})`}
    >
      {GUT_TIER_LABELS[tier]}
      <span className="opacity-70 tabular-nums">· {score}</span>
    </span>
  );
}

/**
 * Selo de prioridade MÉDIA de um plano/opção (média das notas dos procedimentos).
 * Não renderiza nada se nenhum procedimento tiver prioridade definida.
 */
export function GutAverageBadge({
  items,
  className,
}: {
  items: GutInput[];
  className?: string;
}) {
  const avg = gutAverage(items);
  if (!avg) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        TIER_CLASS[avg.tier],
        className
      )}
      title={`Prioridade média do plano (${avg.count} procedimento(s) com prioridade): ${avg.avg}`}
    >
      Prioridade {GUT_TIER_LABELS[avg.tier]}
      <span className="opacity-70 tabular-nums">· média {avg.avg}</span>
    </span>
  );
}
