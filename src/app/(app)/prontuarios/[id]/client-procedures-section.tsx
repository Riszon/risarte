"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CalendarClock,
  ChevronDown,
  CircleCheck,
  CircleDashed,
  Clock,
  Send,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { requestSessionScheduling } from "./treatment-actions";

export type ProcedureSession = {
  id: string;
  name: string | null;
  state: "open" | "scheduled" | "done";
  plannedDate: string | null;
  appointmentAt: string | null;
  providerName: string | null;
  doneAt: string | null;
  executorName: string | null;
};

export type ProcedureRow = {
  itemId: string;
  procedureName: string;
  planId: string;
  planLabel: string;
  /** Estado geral do procedimento (das suas sessões). "none" = sem sessão ainda. */
  state: "none" | "open" | "scheduled" | "done";
  qualityStatus: "aprovado" | "revisao" | "reprovado" | null;
  qualityNote: string | null;
  sessions: ProcedureSession[];
  executorName: string | null;
};

const selectClass =
  "h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR");
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
function fmtYmd(s: string): string {
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
}

const STATE_META: Record<
  ProcedureRow["state"],
  { label: string; cls: string; icon: typeof CircleDashed }
> = {
  none: { label: "A agendar", cls: "text-muted-foreground", icon: CircleDashed },
  open: { label: "Em aberto", cls: "text-amber-600", icon: CircleDashed },
  scheduled: { label: "Agendado", cls: "text-primary", icon: CalendarClock },
  done: { label: "Finalizado", cls: "text-emerald-600", icon: CircleCheck },
};

function QcBadge({ row }: { row: ProcedureRow }) {
  if (!row.qualityStatus) return null;
  const map = {
    aprovado: { label: "Aprovado", cls: "border-emerald-300 bg-emerald-50 text-emerald-800" },
    revisao: { label: "Em revisão", cls: "border-amber-300 bg-amber-50 text-amber-800" },
    reprovado: { label: "Reprovado", cls: "border-rose-300 bg-rose-50 text-rose-800" },
  }[row.qualityStatus];
  return (
    <div className="mt-1">
      <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium ${map.cls}`}>
        Controle de qualidade: {map.label}
      </span>
      {(row.qualityStatus === "revisao" || row.qualityStatus === "reprovado") &&
        row.qualityNote && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            Motivo: {row.qualityNote}
          </p>
        )}
    </div>
  );
}

export function ClientProceduresSection({
  clientId,
  canRequest,
  rows,
}: {
  clientId: string;
  canRequest: boolean;
  rows: ProcedureRow[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showSessions, setShowSessions] = useState(false);
  const [planFilter, setPlanFilter] = useState<string>("");
  const [procFilter, setProcFilter] = useState<string>("");
  const [dentistFilter, setDentistFilter] = useState<string>("");
  const [expanded, setExpanded] = useState<string | null>(null);

  // Opções de filtro.
  const plans = useMemo(
    () => [...new Map(rows.map((r) => [r.planId, r.planLabel])).entries()],
    [rows]
  );
  const dentists = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (r.executorName) set.add(r.executorName);
      for (const s of r.sessions) if (s.providerName) set.add(s.providerName);
    }
    return [...set].sort();
  }, [rows]);

  const filtered = rows.filter((r) => {
    if (planFilter && r.planId !== planFilter) return false;
    if (procFilter && !r.procedureName.toLowerCase().includes(procFilter.toLowerCase()))
      return false;
    if (dentistFilter) {
      const has =
        r.executorName === dentistFilter ||
        r.sessions.some((s) => s.providerName === dentistFilter);
      if (!has) return false;
    }
    return true;
  });

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

  const anyOpen = rows.some((r) => r.state === "open" || r.state === "none");

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Procedimentos</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            {/* Toggle: só procedimentos × com as sessões. */}
            <div className="flex rounded-lg border p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setShowSessions(false)}
                className={cn(
                  "rounded-md px-2 py-1 font-medium",
                  !showSessions ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                )}
              >
                Procedimentos
              </button>
              <button
                type="button"
                onClick={() => setShowSessions(true)}
                className={cn(
                  "rounded-md px-2 py-1 font-medium",
                  showSessions ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                )}
              >
                Com sessões
              </button>
            </div>
            {canRequest && anyOpen && (
              <Button size="sm" variant="outline" disabled={isPending} onClick={request}>
                <Send className="mr-1 size-3" />
                Solicitar agendamento à Recepção
              </Button>
            )}
          </div>
        </div>
        {/* Filtros: plano / procedimento / dentista. */}
        <div className="flex flex-wrap items-center gap-2">
          {plans.length > 1 && (
            <select
              value={planFilter}
              onChange={(e) => setPlanFilter(e.target.value)}
              className={selectClass}
            >
              <option value="">Todos os planos</option>
              {plans.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          )}
          <input
            value={procFilter}
            onChange={(e) => setProcFilter(e.target.value)}
            placeholder="Filtrar procedimento..."
            className={`${selectClass} min-w-[180px]`}
          />
          {dentists.length > 0 && (
            <select
              value={dentistFilter}
              onChange={(e) => setDentistFilter(e.target.value)}
              className={selectClass}
            >
              <option value="">Todos os dentistas</option>
              {dentists.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-2 text-sm">
        {filtered.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nenhum procedimento com esse filtro.
          </p>
        ) : (
          <ul className="space-y-2">
            {filtered.map((r) => {
              const meta = STATE_META[r.state];
              const Icon = meta.icon;
              const isOpen = expanded === r.itemId;
              return (
                <li key={r.itemId} className="rounded-md border p-2.5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{r.procedureName}</span>
                        <Badge variant="secondary" className="text-[10px]">
                          {r.planLabel}
                        </Badge>
                        <span className={cn("inline-flex items-center gap-1 text-xs", meta.cls)}>
                          <Icon className="size-3.5" />
                          {meta.label}
                        </span>
                        {r.sessions.length > 0 && (
                          <span className="text-[11px] text-muted-foreground">
                            {r.sessions.filter((s) => s.state === "done").length}/
                            {r.sessions.length} sessões
                          </span>
                        )}
                      </div>
                      {r.executorName && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Executado por {r.executorName}
                        </p>
                      )}
                      <QcBadge row={r} />
                    </div>
                    {showSessions && r.sessions.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : r.itemId)}
                        aria-label={isOpen ? "Recolher sessões" : "Ver sessões"}
                        className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                      >
                        <ChevronDown
                          className={cn("size-4 transition-transform", !isOpen && "-rotate-90")}
                        />
                      </button>
                    )}
                  </div>

                  {/* Sessões do procedimento (modo "Com sessões" + expandido). */}
                  {showSessions && isOpen && r.sessions.length > 0 && (
                    <ul className="mt-2 space-y-1 border-t pt-2">
                      {r.sessions.map((s, i) => (
                        <li
                          key={s.id}
                          className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
                        >
                          <Clock className="size-3" />
                          <span>Sessão {i + 1}</span>
                          {s.state === "done" ? (
                            <span className="text-emerald-600">
                              concluída{s.doneAt ? ` em ${fmtDate(s.doneAt)}` : ""}
                              {s.executorName ? ` · ${s.executorName}` : ""}
                            </span>
                          ) : s.state === "scheduled" ? (
                            <span className="text-primary">
                              {s.appointmentAt ? fmtDateTime(s.appointmentAt) : "agendada"}
                              {s.providerName ? ` · ${s.providerName}` : ""}
                            </span>
                          ) : (
                            <span>
                              {s.plannedDate
                                ? `prevista ${fmtYmd(s.plannedDate)}`
                                : "aguardando agendamento"}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
