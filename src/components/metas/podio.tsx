import { Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatarPct } from "@/lib/metas/regras";

const LUGAR = [
  { rotulo: "1º", cor: "border-amber-400/60 bg-amber-400/10 text-amber-700 dark:text-amber-300" },
  { rotulo: "2º", cor: "border-slate-400/60 bg-slate-400/10 text-slate-700 dark:text-slate-300" },
  { rotulo: "3º", cor: "border-orange-700/40 bg-orange-700/10 text-orange-800 dark:text-orange-300" },
];

/**
 * M4 (Q4): o pódio da meta — os três primeiros pelo PERCENTUAL do alvo de
 * cada um (a unidade pequena compete com a grande). Recebe a lista já com a
 * posição (`lugar`): empate divide o lugar.
 */
export function PodioDaMeta({ itens }: { itens: { id: string; nome: string; pct: number | null; lugar: number }[] }) {
  const tres = itens.filter((x) => x.pct != null && x.lugar <= 3).slice(0, 3);
  if (tres.length === 0) return null;
  return (
    <ol className="grid gap-2 sm:grid-cols-3" aria-label="Pódio">
      {tres.map((x) => {
        const l = LUGAR[x.lugar - 1] ?? LUGAR[2];
        return (
          <li key={x.id} className={cn("flex min-w-0 items-center gap-2 rounded-lg border p-3", l.cor)}>
            <Trophy className="size-5 shrink-0" aria-hidden />
            <span className="min-w-0">
              <span className="block text-xs font-semibold">{l.rotulo} lugar</span>
              <span className="block truncate text-sm font-medium text-foreground">{x.nome}</span>
              <span className="block text-xs tabular-nums">{formatarPct(x.pct)} do alvo</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
