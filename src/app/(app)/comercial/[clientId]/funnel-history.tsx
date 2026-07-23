"use client";

import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type FunnelEvent = {
  id: string;
  type: string;
  description: string | null;
  actorName: string | null;
  at: string;
};

/** Histórico do cliente no funil comercial (entrada, apresentação, follow-up,
 *  transferências, cancelamentos, fechamento). */
export function FunnelHistoryDialog({ events }: { events: FunnelEvent[] }) {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button type="button" variant="outline" size="sm">
            <History className="mr-1 size-3.5" />
            Histórico do funil
            <span className="ml-1.5 rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">
              {events.length}
            </span>
          </Button>
        }
      />
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Histórico do funil comercial</DialogTitle>
          <DialogDescription>
            Tudo o que aconteceu com este cliente no funil.
          </DialogDescription>
        </DialogHeader>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Ainda sem movimentações no funil.
          </p>
        ) : (
          <ul className="space-y-0">
            {events.map((e) => (
              <li key={e.id} className="relative flex gap-3">
                <div className="flex flex-col items-center">
                  <span
                    className={cn(
                      "mt-1.5 size-2.5 shrink-0 rounded-full",
                      e.type === "venda_concluida"
                        ? "bg-emerald-500"
                        : e.type === "perdido" || e.type === "cancelado"
                          ? "bg-rose-500"
                          : e.type === "transferido_clinica"
                            ? "bg-amber-500"
                            : "bg-primary"
                    )}
                  />
                  <span className="w-px flex-1 bg-border" />
                </div>
                <div className="min-w-0 flex-1 pb-3 text-sm">
                  <p
                    className={cn(
                      "whitespace-pre-wrap",
                      e.type === "venda_concluida" &&
                        "font-medium text-emerald-800"
                    )}
                  >
                    {e.description ?? e.type}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(e.at).toLocaleString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    {e.actorName ? ` · por ${e.actorName}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
