"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  accountLevel,
  ACCOUNT_KIND_LABELS,
  ACCOUNT_NATURE_LABELS,
  ACCOUNT_SCOPE_LABELS,
  COST_BEHAVIOR_LABELS,
  type ChartAccount,
  type CostBehavior,
} from "@/lib/finance/accounts";
import { updateChartAccount } from "../actions";

const BEHAVIOR_STYLE: Record<CostBehavior, string> = {
  fixed: "border-sky-300 bg-sky-50 text-sky-800",
  variable: "border-amber-300 bg-amber-50 text-amber-800",
  none: "border-border bg-muted text-muted-foreground",
};

export function ChartOfAccountsTable({
  accounts,
  canEdit,
}: {
  accounts: ChartAccount[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const [fiscal, setFiscal] = useState("");

  function changeBehavior(code: string, behavior: CostBehavior) {
    startTransition(async () => {
      const r = await updateChartAccount({ code, costBehavior: behavior });
      if (r.ok) {
        toast.success("Classificação atualizada.");
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function saveFiscal(code: string) {
    startTransition(async () => {
      const r = await updateChartAccount({ code, fiscalAccountCode: fiscal });
      if (r.ok) {
        toast.success("Código fiscal salvo.");
        setEditing(null);
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  return (
    <div className={cn("rounded-lg border", isPending && "opacity-70")}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Conta</th>
              <th className="px-3 py-2 text-left font-medium">Tipo</th>
              <th className="px-3 py-2 text-left font-medium">Natureza</th>
              <th className="px-3 py-2 text-left font-medium">Comportamento</th>
              <th className="px-3 py-2 text-left font-medium">Onde vale</th>
              <th className="px-3 py-2 text-left font-medium">Cód. fiscal</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => {
              const level = accountLevel(a.code);
              const isGroup = !a.isAnalytic;
              return (
                <tr
                  key={a.code}
                  className={cn(
                    "border-b last:border-b-0",
                    isGroup && "bg-muted/20 font-medium",
                    !a.active && "opacity-50"
                  )}
                >
                  <td className="px-3 py-1.5">
                    <span
                      className="flex items-center gap-2"
                      style={{ paddingLeft: `${(level - 1) * 1}rem` }}
                    >
                      <span className="font-mono text-xs text-muted-foreground">
                        {a.code}
                      </span>
                      <span>{a.name}</span>
                      {isGroup && (
                        <span className="text-[10px] text-muted-foreground">
                          (grupo)
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-xs">
                    {ACCOUNT_KIND_LABELS[a.kind]}
                  </td>
                  <td className="px-3 py-1.5 text-xs text-muted-foreground">
                    {ACCOUNT_NATURE_LABELS[a.nature]}
                  </td>
                  <td className="px-3 py-1.5">
                    {canEdit && a.isAnalytic ? (
                      <select
                        value={a.costBehavior}
                        onChange={(e) =>
                          changeBehavior(a.code, e.target.value as CostBehavior)
                        }
                        className="h-7 rounded-md border border-input bg-background px-1.5 text-xs"
                      >
                        <option value="fixed">Fixo</option>
                        <option value="variable">Variável</option>
                        <option value="none">Não se aplica</option>
                      </select>
                    ) : (
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px]",
                          BEHAVIOR_STYLE[a.costBehavior]
                        )}
                      >
                        {COST_BEHAVIOR_LABELS[a.costBehavior]}
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-xs text-muted-foreground">
                    {ACCOUNT_SCOPE_LABELS[a.scope]}
                  </td>
                  <td className="px-3 py-1.5 text-xs">
                    {canEdit && a.isAnalytic && editing === a.code ? (
                      <span className="flex items-center gap-1">
                        <input
                          value={fiscal}
                          onChange={(e) => setFiscal(e.target.value)}
                          onBlur={() => saveFiscal(a.code)}
                          className="h-7 w-24 rounded-md border border-input bg-background px-1.5 text-xs"
                          autoFocus
                        />
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={!canEdit || !a.isAnalytic}
                        onClick={() => {
                          setEditing(a.code);
                          setFiscal(a.fiscalAccountCode ?? "");
                        }}
                        className={cn(
                          "text-muted-foreground",
                          canEdit && a.isAnalytic && "hover:underline"
                        )}
                      >
                        {a.fiscalAccountCode ?? "—"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
