"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarClock, CircleCheck, CircleDashed, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requestSessionScheduling } from "./treatment-actions";

export type ProcedureItem = {
  id: string;
  procedureName: string;
  name: string | null;
  group: "open" | "scheduled" | "done";
  plannedDate: string | null;
  appointmentAt: string | null;
  providerName: string | null;
  doneAt: string | null;
  executorName: string | null;
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
/** "YYYY-MM-DD" (sem fuso) → "dd/mm/aaaa". */
function fmtYmd(s: string): string {
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
}

function label(it: ProcedureItem): string {
  return it.name ? `${it.procedureName} — ${it.name}` : it.procedureName;
}

export function ClientProceduresSection({
  clientId,
  canRequest,
  items,
}: {
  clientId: string;
  canRequest: boolean;
  items: ProcedureItem[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const open = items.filter((i) => i.group === "open");
  const scheduled = items.filter((i) => i.group === "scheduled");
  const done = items.filter((i) => i.group === "done");

  function request() {
    startTransition(async () => {
      const res = await requestSessionScheduling(clientId);
      if (res.ok) {
        toast.success("Solicitação enviada à Recepção.");
        router.refresh();
      } else {
        toast.error(res.error ?? "Não foi possível enviar a solicitação.");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Procedimentos</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {/* Em aberto */}
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 font-medium">
              <CircleDashed className="size-4 text-amber-600" />
              Em aberto <Badge variant="secondary">{open.length}</Badge>
            </h3>
            {canRequest && open.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={request}
              >
                <Send className="mr-1 size-3" />
                Solicitar agendamento à Recepção
              </Button>
            )}
          </div>
          {open.length > 0 ? (
            <ul className="space-y-1.5">
              {open.map((it) => (
                <li key={it.id} className="rounded-md border p-2">
                  <span className="font-medium">{label(it)}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {it.plannedDate
                      ? `prevista para ${fmtYmd(it.plannedDate)} · aguardando agendamento`
                      : "aguardando agendamento"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              Nenhum procedimento em aberto.
            </p>
          )}
        </div>

        {/* Agendados */}
        <div>
          <h3 className="mb-1.5 flex items-center gap-1.5 font-medium">
            <CalendarClock className="size-4 text-primary" />
            Agendados <Badge variant="secondary">{scheduled.length}</Badge>
          </h3>
          {scheduled.length > 0 ? (
            <ul className="space-y-1.5">
              {scheduled.map((it) => (
                <li key={it.id} className="rounded-md border p-2">
                  <span className="font-medium">{label(it)}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {it.appointmentAt && fmtDateTime(it.appointmentAt)}
                    {it.providerName ? ` · ${it.providerName}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              Nenhuma sessão agendada.
            </p>
          )}
        </div>

        {/* Finalizados */}
        <div>
          <h3 className="mb-1.5 flex items-center gap-1.5 font-medium">
            <CircleCheck className="size-4 text-emerald-600" />
            Finalizados <Badge variant="secondary">{done.length}</Badge>
          </h3>
          {done.length > 0 ? (
            <ul className="space-y-1.5">
              {done.map((it) => (
                <li key={it.id} className="rounded-md border p-2">
                  <span className="font-medium">{label(it)}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {it.doneAt ? `concluído em ${fmtDate(it.doneAt)}` : "concluído"}
                    {it.executorName ? ` · por ${it.executorName}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              Nenhum procedimento finalizado ainda.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
