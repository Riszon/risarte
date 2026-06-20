"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Share2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { endClientShare, shareClientWithUnit } from "./share-actions";

const REASONS: { value: string; label: string }[] = [
  { value: "urgency", label: "Urgência" },
  { value: "emergency", label: "Emergência" },
  { value: "procedure", label: "Procedimento não disponível na unidade" },
  { value: "other", label: "Outro" },
];

const REASON_LABELS: Record<string, string> = Object.fromEntries(
  REASONS.map((r) => [r.value, r.label])
);

export type ActiveShare = {
  id: string;
  clinicName: string;
  reason: string | null;
  startedAt: string;
  sharedByName: string | null;
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ClientShares({
  clientId,
  shares,
  units,
  canShare,
  canEnd,
}: {
  clientId: string;
  shares: ActiveShare[];
  units: { id: string; name: string }[];
  /** Show the "share with another unit" form (home unit / admin). */
  canShare: boolean;
  /** Show the "Encerrar" buttons (home unit, shared unit, or admin). */
  canEnd: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [unitId, setUnitId] = useState("");
  const [reason, setReason] = useState("urgency");

  // Nothing to show for staff who can't act and there are no active shares.
  if (!canShare && !canEnd && shares.length === 0) return null;

  const selectClass =
    "h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm";

  function share() {
    startTransition(async () => {
      const result = await shareClientWithUnit(clientId, unitId, reason);
      if (result.ok) {
        toast.success("Cliente compartilhado com a unidade.");
        setUnitId("");
        router.refresh();
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

  function end(shareId: string) {
    startTransition(async () => {
      const result = await endClientShare(shareId, clientId);
      if (result.ok) {
        toast.success("Compartilhamento encerrado.");
        router.refresh();
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

  // Units not already actively shared with (and not the home unit).
  const sharedNames = new Set(shares.map((s) => s.clinicName));
  const available = units.filter((u) => !sharedNames.has(u.name));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Share2 className="size-4" />
          Compartilhamento entre unidades
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {shares.length > 0 ? (
          <ul className="space-y-1.5">
            {shares.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium">{s.clinicName}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.reason ? `${REASON_LABELS[s.reason] ?? s.reason} · ` : ""}
                    desde {fmtDate(s.startedAt)}
                    {s.sharedByName ? ` · por ${s.sharedByName}` : ""}
                  </p>
                </div>
                {canEnd && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    disabled={isPending}
                    onClick={() => end(s.id)}
                  >
                    <X className="mr-1 size-3.5" />
                    Encerrar
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            Este cliente não está compartilhado com outra unidade.
          </p>
        )}

        {canShare && available.length > 0 && (
          <div className="space-y-2 rounded-md border border-dashed p-3">
            <Label>Compartilhar com outra unidade (temporário)</Label>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={unitId}
                onChange={(e) => setUnitId(e.target.value)}
                className={selectClass}
              >
                <option value="">Escolha a unidade...</option>
                {available.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className={selectClass}
              >
                {REASONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
              <Button size="sm" disabled={!unitId || isPending} onClick={share}>
                Compartilhar
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              A outra unidade poderá agendar e atender este cliente sem misturar
              o plano/financeiro. O cliente continua sendo da unidade atual.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
