"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { endClientShare } from "./[id]/share-actions";

const REASON_LABELS: Record<string, string> = {
  urgency: "Urgência",
  emergency: "Emergência",
  procedure: "Procedimento não disponível na unidade",
  other: "Outro",
};

export type SharedEntry = {
  shareId: string;
  clientId: string;
  clientName: string;
  /** Unidade dona do cliente. */
  homeClinicName: string;
  /** Unidade com quem foi compartilhado. */
  sharedClinicName: string;
  reason: string | null;
  startedAt: string;
  sharedByName: string | null;
  direction: "in" | "out";
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

export function SharedClientsList({
  entries,
  canEnd,
}: {
  entries: SharedEntry[];
  /** Recepção/Coordenador/Gerente (ou Admin) podem encerrar. */
  canEnd: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function end(shareId: string, clientId: string) {
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

  return (
    <ul className="space-y-2">
      {entries.map((e) => (
        <li
          key={e.shareId}
          className="flex flex-wrap items-start justify-between gap-2 rounded-md border bg-card p-3"
        >
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/prontuarios/${e.clientId}`}
                className="font-medium hover:underline"
              >
                {e.clientName}
              </Link>
              <Badge variant="secondary" className="text-[10px]">
                {e.direction === "in"
                  ? `Origem: ${e.homeClinicName}`
                  : `Compartilhado com: ${e.sharedClinicName}`}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Cliente da unidade{" "}
              <span className="font-medium">{e.homeClinicName}</span>
              {e.reason
                ? ` · ${REASON_LABELS[e.reason] ?? e.reason}`
                : ""}{" "}
              · desde {fmtDate(e.startedAt)}
              {e.sharedByName ? ` · por ${e.sharedByName}` : ""}
            </p>
          </div>
          {canEnd && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={isPending}
              onClick={() => end(e.shareId, e.clientId)}
            >
              <X className="mr-1 size-3.5" />
              Encerrar
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
