"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { setItemQuality } from "./quality-actions";

type QStatus = "aprovado" | "revisao" | "reprovado";

export type QualityItem = {
  id: string;
  description: string;
  status: QStatus | null;
  note: string | null;
};

const OPTIONS: { value: QStatus; label: string; on: string }[] = [
  { value: "aprovado", label: "Aprovado", on: "border-emerald-500 bg-emerald-500 text-white" },
  { value: "revisao", label: "Revisão", on: "border-amber-500 bg-amber-500 text-white" },
  { value: "reprovado", label: "Reprovado", on: "border-rose-500 bg-rose-500 text-white" },
];

/**
 * Bloco D — checklist de qualidade do último plano concluído. O Coordenador
 * marca cada procedimento (aprovado/revisão/reprovado). 100% aprovado = plano
 * travado (não pede mais revisão).
 */
export function QualityChecklist({
  clientId,
  planTitle,
  items,
  locked,
}: {
  clientId: string;
  planTitle: string;
  items: QualityItem[];
  locked: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [notes, setNotes] = useState<Record<string, string>>(
    Object.fromEntries(items.map((i) => [i.id, i.note ?? ""]))
  );

  function mark(itemId: string, status: QStatus) {
    startTransition(async () => {
      const r = await setItemQuality(clientId, itemId, status, notes[itemId]);
      if (r.ok) {
        toast.success("Conferência registrada.");
        router.refresh();
      } else {
        toast.error(r.error ?? "Algo deu errado.");
      }
    });
  }

  const approvedCount = items.filter((i) => i.status === "aprovado").length;

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          Controle de qualidade — {planTitle}
        </p>
        <span className="text-xs text-muted-foreground">
          {approvedCount}/{items.length} aprovados
        </span>
      </div>

      {locked && (
        <p className="flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-800">
          <Lock className="size-3.5" />
          Plano 100% aprovado — controle de qualidade concluído. Não pede mais
          revisão.
        </p>
      )}

      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.id} className="rounded-md border p-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 flex-1 text-sm">
                {item.status === "aprovado" && (
                  <CheckCircle2 className="mr-1 inline size-3.5 text-emerald-600" />
                )}
                {item.description}
              </span>
              {!locked ? (
                <div className="flex gap-1">
                  {OPTIONS.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      disabled={isPending}
                      onClick={() => mark(item.id, o.value)}
                      className={cn(
                        "rounded-md border px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50",
                        item.status === o.value ? o.on : "hover:bg-muted"
                      )}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              ) : (
                item.status && (
                  <span className="rounded-md border px-2 py-1 text-xs font-medium">
                    {OPTIONS.find((o) => o.value === item.status)?.label}
                  </span>
                )
              )}
            </div>
            {!locked && (item.status === "revisao" || item.status === "reprovado") && (
              <input
                value={notes[item.id] ?? ""}
                onChange={(e) =>
                  setNotes((prev) => ({ ...prev, [item.id]: e.target.value }))
                }
                onBlur={() => item.status && mark(item.id, item.status)}
                placeholder="Motivo da revisão/reprovação (opcional)"
                className="mt-2 w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-xs"
              />
            )}
            {locked && item.note && (
              <p className="mt-1 text-xs text-muted-foreground">{item.note}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
