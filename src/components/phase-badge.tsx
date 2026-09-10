import {
  JOURNEY_PHASES,
  PHASE_COLORS,
  PHASE_LABELS,
  type JourneyPhase,
} from "@/lib/journey";
import { cn } from "@/lib/utils";

/** Estilo suave (fundo levinho + texto contrastado) na cor oficial da fase.
 * Reaproveitável em pílulas, células de tabela e selos que mostram a fase.
 *
 * ⚠️ A MATIZ DA FASE NÃO MUDA NUNCA. As sete cores de `PHASE_COLORS` foram
 * definidas pelo dono e a mudança de identidade visual de 09/09/2026 passou por
 * cima do sistema inteiro SEM tocar nelas, por ordem dele.
 *
 * O que muda com o tema é só para que lado o texto é puxado: contra o preto no
 * claro, contra o branco no escuro (`--fase-contraste`). Fixar em `black`
 * deixaria letra escura sobre fundo escuro — a cor certa, ilegível. */
export function phaseTintStyle(phase: JourneyPhase): React.CSSProperties {
  const c = PHASE_COLORS[phase];
  return {
    backgroundColor: `color-mix(in oklab, ${c} 15%, transparent)`,
    color: `color-mix(in oklab, ${c} 58%, var(--fase-contraste, black))`,
    borderColor: `color-mix(in oklab, ${c} 30%, transparent)`,
  };
}

/** Selo da fase da jornada com a cor oficial (suavizada). Usar em qualquer lugar
 * que mostre em que fase o cliente está (agenda, ficha, listas, dashboards…). */
export function PhaseBadge({
  phase,
  showNumber = false,
  className,
}: {
  phase: JourneyPhase;
  /** Prefixa o número da fase (1..7). */
  showNumber?: boolean;
  className?: string;
}) {
  const idx = JOURNEY_PHASES.indexOf(phase);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        className
      )}
      style={phaseTintStyle(phase)}
    >
      {showNumber && idx >= 0 && (
        <span className="font-semibold tabular-nums opacity-80">{idx + 1}</span>
      )}
      {PHASE_LABELS[phase]}
    </span>
  );
}
