import { formatBRL } from "@/lib/pricing";
import { cn } from "@/lib/utils";

export type MoneyRow = {
  label: string;
  cents: number;
  /** "program" = benefício do plano (dourado); "discount"/"surcharge" = ajuste. */
  tone?: "muted" | "program" | "discount" | "surcharge";
  /** Detalhe curto entre parênteses (ex.: "5% à vista"). */
  note?: string;
};

const TONE: Record<NonNullable<MoneyRow["tone"]>, string> = {
  muted: "text-muted-foreground",
  program: "text-gold",
  discount: "text-muted-foreground",
  surcharge: "text-muted-foreground",
};

/**
 * J6: o RESUMO DO DINHEIRO das duas telas, num formato só. Linhas discretas e
 * **um** valor em destaque — o dono reclamou de "muitos valores" espalhados, e a
 * regra aqui é: só entra linha que muda o total.
 */
export function MoneySummary({
  rows,
  totalLabel = "Valor final",
  totalCents,
  /** Linha de baixo: como o pagamento fica ("entrada + 5× de ..."). */
  footer,
  className,
}: {
  rows: MoneyRow[];
  totalLabel?: string;
  totalCents: number;
  footer?: string | null;
  className?: string;
}) {
  const visible = rows.filter((r) => r.cents !== 0);
  return (
    <dl
      className={cn(
        "space-y-0.5 rounded-lg border bg-muted/30 px-2.5 py-2 text-xs",
        className
      )}
    >
      {visible.map((r, i) => (
        <div key={i} className="flex items-baseline justify-between gap-2">
          <dt className={cn(TONE[r.tone ?? "muted"])}>
            {r.tone === "program" && "★ "}
            {r.label}
            {r.note && (
              <span className="ml-1 text-[10px] text-muted-foreground">
                ({r.note})
              </span>
            )}
          </dt>
          <dd className={cn("tabular-nums", TONE[r.tone ?? "muted"])}>
            {r.tone === "discount" || r.tone === "program"
              ? `− ${formatBRL(Math.abs(r.cents))}`
              : r.tone === "surcharge"
                ? `+ ${formatBRL(Math.abs(r.cents))}`
                : formatBRL(r.cents)}
          </dd>
        </div>
      ))}
      <div
        className={cn(
          "flex items-baseline justify-between gap-2",
          visible.length > 0 && "border-t pt-1"
        )}
      >
        <dt className="font-semibold">{totalLabel}</dt>
        <dd className="text-base font-semibold tabular-nums">
          {formatBRL(totalCents)}
        </dd>
      </div>
      {footer && (
        <p className="pt-0.5 text-right text-[11px] text-muted-foreground">
          {footer}
        </p>
      )}
    </dl>
  );
}
