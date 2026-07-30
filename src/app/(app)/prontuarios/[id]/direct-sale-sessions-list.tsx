"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { DirectSaleSession } from "./direct-sale-loader";

const STATE_STYLE: Record<DirectSaleSession["state"], string> = {
  done: "border-emerald-300 bg-emerald-50 text-emerald-700",
  scheduled: "border-sky-300 bg-sky-50 text-sky-700",
  open: "border-amber-300 bg-amber-50 text-amber-700",
  // J4a: venda cancelada → o procedimento não vale mais (fica no histórico).
  cancelled: "border-border bg-muted text-muted-foreground",
};
const STATE_LABEL: Record<DirectSaleSession["state"], string> = {
  done: "Concluído",
  scheduled: "Agendado",
  open: "Em aberto",
  cancelled: "Cancelado",
};

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Lista dos procedimentos avulsos (venda direta) com um botão para MOSTRAR /
 * OCULTAR os detalhes (concluído por quem, agendado com quem e para quando) —
 * some por padrão para não poluir a tela, mas a informação não se perde.
 */
export function DirectSaleSessionsList({
  sessions,
}: {
  sessions: DirectSaleSession[];
}) {
  const [showDetails, setShowDetails] = useState(false);
  if (sessions.length === 0) return null;

  return (
    <div className="rounded-lg border bg-background p-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          Procedimentos ({sessions.length})
        </span>
        <button
          type="button"
          onClick={() => setShowDetails((v) => !v)}
          className="text-[11px] text-primary hover:underline"
        >
          {showDetails ? "Ocultar detalhes" : "Ver detalhes"}
        </button>
      </div>
      <ul className="space-y-1 text-xs">
        {sessions.map((s) => (
          <li key={s.id}>
            <div className="flex items-center justify-between gap-2">
              <span
                className={cn(
                  "min-w-0",
                  s.state === "cancelled" &&
                    "text-muted-foreground line-through"
                )}
              >
                {s.procedureName}
              </span>
              <span
                className={cn(
                  "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium",
                  STATE_STYLE[s.state]
                )}
              >
                {STATE_LABEL[s.state]}
              </span>
            </div>
            {showDetails && (
              <p className="mt-0.5 pl-1 text-[11px] leading-relaxed text-muted-foreground">
                {s.state === "done" && (
                  <>
                    Concluído
                    {s.doneAt ? ` em ${fmt(s.doneAt)}` : ""}
                    {s.executorName ? ` · por ${s.executorName}` : ""}
                  </>
                )}
                {s.state === "cancelled" &&
                  "A venda deste procedimento foi cancelada."}
                {s.state !== "done" &&
                  s.state !== "cancelled" &&
                  s.appointmentAt && (
                    <>
                      Agendado para {fmt(s.appointmentAt)}
                      {s.providerName ? ` · com ${s.providerName}` : ""}
                    </>
                  )}
                {s.state !== "done" &&
                  s.state !== "cancelled" &&
                  !s.appointmentAt &&
                  "Sem agendamento."}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
