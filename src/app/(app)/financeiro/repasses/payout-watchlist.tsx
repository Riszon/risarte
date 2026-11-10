"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing";
import {
  countRecalculable,
  groupWatchRows,
  watchReasonText,
  type WatchRow,
} from "@/lib/finance/payout-watchlist";
import { recalculatePayout, recalculateZeroPayouts } from "./actions";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/**
 * 0387 — o que ainda NÃO virou repasse com valor, e por quê.
 *
 * Vale para a unidade inteira, não só para o mês que está na tela: um
 * procedimento zerado de outubro continua sendo pendência em novembro.
 */
export function PayoutWatchlist({
  clinicId,
  rows,
  canEdit,
}: {
  clinicId: string;
  rows: WatchRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  if (rows.length === 0) return null;

  const groups = groupWatchRows(rows);
  const recalculaveis = countRecalculable(rows);

  function recalcOne(id: string) {
    startTransition(async () => {
      const r = await recalculatePayout({ payoutId: id });
      if (!r.ok) toast.error(r.error ?? "Algo deu errado.");
      else if ((r.amountCents ?? 0) > 0) {
        toast.success(`Repasse recalculado: ${formatBRL(r.amountCents ?? 0)}.`);
      } else {
        toast.message("Continua sem valor — veja o motivo na linha.");
      }
      router.refresh();
    });
  }

  function recalcAll() {
    startTransition(async () => {
      const r = await recalculateZeroPayouts({ clinicId });
      if (!r.ok) toast.error(r.error ?? "Algo deu errado.");
      else {
        const n = r.fixed ?? 0;
        toast.success(
          n === 0
            ? "Nenhum repasse zerado pôde ser recalculado."
            : `${n} repasse${n === 1 ? "" : "s"} recalculado${n === 1 ? "" : "s"}.`
        );
      }
      router.refresh();
    });
  }

  return (
    <Card className={cn(isPending && "opacity-70")}>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 font-medium">
              <AlertTriangle className="size-4 text-amber-600" />
              Pendências do repasse
            </h2>
            <p className="text-xs text-muted-foreground">
              O que foi feito na unidade e ainda não virou repasse com valor, e
              o motivo. Vale para todos os meses.
            </p>
          </div>
          {canEdit && recalculaveis > 0 && (
            <Button size="sm" disabled={isPending} onClick={recalcAll}>
              <RefreshCw className="mr-1 size-3.5" />
              Recalcular os {recalculaveis} zerado
              {recalculaveis === 1 ? "" : "s"} que já têm valor
            </Button>
          )}
        </div>

        {groups.map((g) => (
          <div key={g.kind} className="space-y-1">
            <h3 className="text-sm font-medium">
              {g.title}{" "}
              <span className="text-xs font-normal text-muted-foreground">
                ({g.rows.length})
              </span>
            </h3>
            <ul className="divide-y divide-dashed rounded-lg border text-sm">
              {g.rows.map((r, i) => (
                <li
                  key={r.payoutId ?? r.sessionId ?? `${g.kind}-${i}`}
                  className="flex flex-wrap items-start justify-between gap-2 p-2"
                >
                  <div className="min-w-0 flex-1">
                    <p>
                      <span className="font-medium">
                        {r.procedureName ?? "Procedimento"}
                      </span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {r.providerName ?? "sem profissional"} ·{" "}
                        {fmtDate(r.refDate)}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {watchReasonText(r, formatBRL)}
                    </p>
                  </div>
                  {canEdit && r.kind === "zerado" && r.payoutId && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isPending}
                      onClick={() => recalcOne(r.payoutId as string)}
                    >
                      Recalcular
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
