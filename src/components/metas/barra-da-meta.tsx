import { cn } from "@/lib/utils";
import { FAROL_COR, formatarPct, type Farol } from "@/lib/metas/regras";

/**
 * A BARRA DE PERCENTUAL DA META.
 *
 * A barra para em 100% (ou na Super Meta, quando houver); o NÚMERO ao lado
 * mostra o real — 128% é 128%. Com Super Meta, a régua vai até ela e um traço
 * marca onde fica a meta (100%).
 *
 * A cor do preenchimento é o farol do ritmo (verde/âmbar/vermelho), e o
 * farol nunca é o único sinal: o texto do lado diz a mesma coisa em palavras.
 */
export function BarraDaMeta({
  pct,
  pctSuper,
  farol = "neutro",
  esperado,
  tamanho = "md",
  limite = false,
  className,
}: {
  pct: number | null;
  pctSuper?: number | null;
  farol?: Farol;
  /** 0–1: onde a equipe deveria estar hoje (um tique sobre a barra). */
  esperado?: number | null;
  tamanho?: "sm" | "md";
  /** Meta de limite: a barra é o uso do limite — passar de 100% é ruim. */
  limite?: boolean;
  className?: string;
}) {
  const teto = pctSuper && pctSuper > 100 ? pctSuper : 100;
  const largura = pct == null ? 0 : Math.max(0, Math.min(pct, teto)) / teto * 100;
  const marcaMeta = teto > 100 ? (100 / teto) * 100 : null;
  const marcaRitmo = esperado != null && esperado > 0 && esperado < 1 ? (esperado * 100 * 100) / teto : null;
  const cor =
    farol !== "neutro"
      ? FAROL_COR[farol]
      : limite
        ? (pct ?? 0) > 100
          ? FAROL_COR.vermelho
          : FAROL_COR.verde
        : (pct ?? 0) >= 100
          ? FAROL_COR.verde
          : FAROL_COR.neutro;
  return (
    <div
      className={cn("relative w-full overflow-visible", className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct == null ? undefined : Math.round(pct)}
      aria-valuetext={pct == null ? "sem medida" : `${formatarPct(pct)} ${limite ? "do limite" : "da meta"}`}
    >
      <div className={cn("overflow-hidden rounded-full bg-muted", tamanho === "sm" ? "h-1.5" : "h-3")}>
        <div className={cn("h-full rounded-full transition-[width]", cor)} style={{ width: `${largura}%` }} />
      </div>
      {marcaRitmo != null && (
        <span
          aria-hidden
          title="Onde a equipe deveria estar hoje"
          className="absolute -top-0.5 h-[calc(100%+4px)] w-0.5 rounded bg-foreground/50"
          style={{ left: `${marcaRitmo}%` }}
        />
      )}
      {marcaMeta != null && (
        <span
          aria-hidden
          title="Meta (100%) — depois dela, a Super Meta"
          className="absolute -top-1 h-[calc(100%+8px)] w-0.5 rounded bg-gold"
          style={{ left: `${marcaMeta}%` }}
        />
      )}
    </div>
  );
}
