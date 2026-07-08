"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatMinutes, formatSessions, intervalSummary } from "@/lib/pricing";
import { reviewProtocolProposal } from "./actions";

export type PendingProposal = {
  id: string;
  procedureName: string;
  scopeLabel: string;
  proposedByName: string | null;
  note: string | null;
  sessions: { name?: string; minutes?: number; intervalDays?: number | null }[];
  canReview: boolean;
};

export function ProtocolProposals({
  proposals,
}: {
  proposals: PendingProposal[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  if (proposals.length === 0) return null;

  function decide(id: string, approve: boolean, notes: string) {
    startTransition(async () => {
      const r = await reviewProtocolProposal(id, approve, notes);
      if (r.ok) {
        toast.success(
          approve ? "Proposta aprovada e aplicada." : "Proposta recusada."
        );
        setRejectingId(null);
        setReason("");
        router.refresh();
      } else {
        toast.error(r.error ?? "Algo deu errado.");
      }
    });
  }

  return (
    <Card className="border-gold/50">
      <CardHeader>
        <CardTitle className="text-base">
          Propostas de protocolo pendentes ({proposals.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {proposals.map((pr) => {
          const total = pr.sessions.reduce((s, x) => s + (x.minutes || 0), 0);
          const iv = intervalSummary(
            pr.sessions.map((x) => ({ minIntervalDays: x.intervalDays ?? null }))
          );
          return (
            <div key={pr.id} className="space-y-2 rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">
                  {pr.procedureName}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    · {pr.scopeLabel}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">
                  por {pr.proposedByName ?? "—"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Proposto: {formatSessions(pr.sessions.length)} ·{" "}
                {formatMinutes(total)}
                {iv ? ` · ${iv}` : ""}
              </p>
              {pr.note && <p className="text-xs">Justificativa: {pr.note}</p>}
              {pr.canReview ? (
                rejectingId === pr.id ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Motivo da recusa"
                      className="h-8 min-w-0 flex-1"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isPending || !reason.trim()}
                      onClick={() => decide(pr.id, false, reason)}
                    >
                      Confirmar recusa
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setRejectingId(null);
                        setReason("");
                      }}
                    >
                      Cancelar
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={isPending}
                      onClick={() => decide(pr.id, true, "")}
                    >
                      Aprovar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setRejectingId(pr.id);
                        setReason("");
                      }}
                    >
                      Recusar
                    </Button>
                  </div>
                )
              ) : (
                <p className="text-xs italic text-muted-foreground">
                  Aguardando revisão.
                </p>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
