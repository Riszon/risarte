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
import type { PlanEvent } from "@/lib/planning";

/**
 * Histórico próprio de UM plano de tratamento (linha do tempo completa, com
 * autor de cada evento). Usado no editor do plano (Planner/Coordenador) e no
 * cockpit do Consultor Comercial — mesma linha do tempo para todos.
 */
export function PlanHistoryDialog({
  events,
  triggerLabel = "Histórico do plano",
}: {
  events: PlanEvent[];
  triggerLabel?: string;
}) {
  if (events.length === 0) return null;
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button type="button" variant="outline" size="sm">
            <History className="mr-1 size-3.5" />
            {triggerLabel}
            <span className="ml-1.5 rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">
              {events.length}
            </span>
          </Button>
        }
      />
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Histórico do plano</DialogTitle>
          <DialogDescription>
            Tudo o que aconteceu com este plano, do rascunho ao fim.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-0">
          {events.map((e) => (
            <li key={e.id} className="relative flex gap-3">
              <div className="flex flex-col items-center">
                <span
                  className={cn(
                    "mt-1.5 size-2.5 shrink-0 rounded-full",
                    e.type === "devolvido_comercial" ||
                      e.type === "devolvido_coordenador"
                      ? "bg-rose-500"
                      : e.type === "aprovado_coordenador" ||
                          e.type === "lifecycle_aceito" ||
                          e.type === "lifecycle_concluido"
                        ? "bg-emerald-500"
                        : "bg-primary"
                  )}
                />
                <span className="w-px flex-1 bg-border" />
              </div>
              <div className="min-w-0 flex-1 pb-3 text-sm">
                <p
                  className={cn(
                    "whitespace-pre-wrap",
                    e.type === "devolvido_comercial" &&
                      "font-medium text-rose-800"
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
      </DialogContent>
    </Dialog>
  );
}
