"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarCheck, CalendarPlus, CalendarRange } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AppointmentFormDialog } from "../../agenda/appointment-form-dialog";
import { AppointmentInfoDialog } from "../../agenda/appointment-info-dialog";
import type { AgendaAppointment } from "../../agenda/week-grid";
import type { AgendaFormConfig } from "../../agenda/actions";
import type { StaffOption } from "@/lib/appointments";
import { suggestTreatmentSeries } from "./treatment-actions";

export type TreatmentSession = {
  id: string;
  procedureName: string;
  sessionIndex: number;
  sessionTotal: number;
  name: string | null;
  plannedMinutes: number | null;
  actualMinutes: number | null;
  status: "pending" | "scheduled" | "done";
  /** H4.3 Lote 2: data sugerida ("YYYY-MM-DD"), ou null. */
  plannedDate: string | null;
  /** H3.14: agendamento vinculado (quando/quem) — permite abrir os detalhes. */
  appointment: AgendaAppointment | null;
};

/** "YYYY-MM-DD" → "DD/MM/AAAA". */
function formatPlanned(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/** H3.14: "DD/MM às HH:MM" a partir do horário do agendamento. */
function formatWhen(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  const time = d.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${day} às ${time}`;
}

const STATUS_LABEL: Record<TreatmentSession["status"], string> = {
  pending: "A agendar",
  scheduled: "Agendado",
  done: "Concluído",
};

export function TreatmentSessionsPanel({
  clientId,
  clientName,
  clientInactive,
  sessions,
  canSchedule,
  staff,
  config,
  clinicId,
}: {
  clientId: string;
  clientName: string;
  clientInactive: boolean;
  sessions: TreatmentSession[];
  canSchedule: boolean;
  staff: StaffOption[];
  config?: AgendaFormConfig;
  clinicId: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [startDate, setStartDate] = useState(todayIso());

  // Agrupa por procedimento, preservando a ordem.
  const groups: { name: string; sessions: TreatmentSession[] }[] = [];
  for (const s of sessions) {
    let g = groups.find((x) => x.name === s.procedureName);
    if (!g) {
      g = { name: s.procedureName, sessions: [] };
      groups.push(g);
    }
    g.sessions.push(s);
  }

  const pending = sessions.filter((s) => s.status === "pending").length;
  const hasSuggestions = sessions.some((s) => s.plannedDate);

  // H4.3 Lote 3: intervalo médio REAL entre as sessões já feitas (deste paciente).
  const doneTimes = sessions
    .filter((s) => s.status === "done" && s.appointment)
    .map((s) => new Date(s.appointment!.starts_at).getTime())
    .sort((a, b) => a - b);
  let realAvgDays: number | null = null;
  if (doneTimes.length >= 2) {
    let sum = 0;
    for (let i = 1; i < doneTimes.length; i++) {
      sum += (doneTimes[i] - doneTimes[i - 1]) / 86_400_000;
    }
    realAvgDays = Math.round(sum / (doneTimes.length - 1));
  }

  // Previsão de conclusão: a última data entre as sessões ainda não concluídas
  // (agendadas usam o agendamento; pendentes usam a data prevista).
  const futureDates: string[] = [];
  for (const s of sessions) {
    if (s.status === "done") continue;
    if (s.appointment) futureDates.push(s.appointment.starts_at.slice(0, 10));
    else if (s.plannedDate) futureDates.push(s.plannedDate);
  }
  futureDates.sort();
  const forecast = futureDates.length ? futureDates[futureDates.length - 1] : null;
  const forecastPartial = sessions.some(
    (s) => s.status !== "done" && !s.appointment && !s.plannedDate
  );

  function suggest() {
    startTransition(async () => {
      const result = await suggestTreatmentSeries(clientId, startDate);
      if (result.ok) {
        toast.success("Datas sugeridas para toda a série.");
        router.refresh();
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Sessões do tratamento a agendar{" "}
          {pending > 0 && (
            <span className="text-sm font-normal text-muted-foreground">
              ({pending} a agendar)
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {canSchedule && pending > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-2 text-sm">
            <CalendarRange className="size-4 text-muted-foreground" />
            <span className="text-muted-foreground">
              Sugerir datas da série a partir de:
            </span>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-8 w-40"
            />
            <Button size="sm" variant="outline" disabled={isPending} onClick={suggest}>
              {isPending
                ? "Calculando..."
                : hasSuggestions
                  ? "Recalcular"
                  : "Sugerir datas"}
            </Button>
            <span className="text-xs text-muted-foreground">
              respeita o intervalo mínimo do protocolo e pula dias fechados.
            </span>
          </div>
        )}

        {(realAvgDays !== null || forecast) && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg bg-muted/40 px-3 py-2 text-xs">
            {realAvgDays !== null && (
              <span>
                Intervalo médio real:{" "}
                <strong>{realAvgDays} dias</strong>{" "}
                <span className="text-muted-foreground">
                  (entre as sessões já feitas)
                </span>
              </span>
            )}
            {forecast && (
              <span>
                Previsão de conclusão:{" "}
                <strong>{formatPlanned(forecast)}</strong>
                {forecastPartial && (
                  <span className="text-muted-foreground">
                    {" "}
                    (parcial — sugira as datas restantes)
                  </span>
                )}
              </span>
            )}
          </div>
        )}
        {groups.map((g) => (
          <div key={g.name}>
            <p className="text-sm font-medium">{g.name}</p>
            <ul className="mt-1 space-y-1">
              {g.sessions.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-2 text-sm"
                >
                  <span>
                    {s.name ?? `Sessão ${s.sessionIndex} de ${s.sessionTotal}`}
                    {s.plannedMinutes ? (
                      <span className="text-xs text-muted-foreground">
                        {" "}
                        · {s.plannedMinutes} min
                      </span>
                    ) : null}
                  </span>
                  <span className="flex items-center gap-2">
                    {s.status === "scheduled" && s.appointment ? (
                      // H3.14: mostra quando e com quem; clicável abre os detalhes.
                      <AppointmentInfoDialog
                        appointment={s.appointment}
                        trigger={
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-auto max-w-[16rem] justify-start whitespace-normal py-1 text-left"
                          >
                            <CalendarCheck className="mr-1 size-3.5 shrink-0" />
                            <span>
                              {formatWhen(s.appointment.starts_at)}
                              {s.appointment.provider?.full_name
                                ? ` · ${s.appointment.provider.full_name}`
                                : ""}
                            </span>
                          </Button>
                        }
                      />
                    ) : (
                      <span className="flex items-center gap-2">
                        <Badge
                          variant={
                            s.status === "pending" ? "outline" : "secondary"
                          }
                        >
                          {STATUS_LABEL[s.status]}
                          {s.status === "done" && s.actualMinutes
                            ? ` · durou ${s.actualMinutes} min`
                            : ""}
                        </Badge>
                        {s.status === "pending" && s.plannedDate && (
                          <span className="text-xs text-muted-foreground">
                            prevista {formatPlanned(s.plannedDate)}
                          </span>
                        )}
                      </span>
                    )}
                    {canSchedule && s.status === "pending" && (
                      <AppointmentFormDialog
                        clients={[
                          {
                            id: clientId,
                            full_name: clientName,
                            inactive: clientInactive,
                          },
                        ]}
                        staff={staff}
                        config={config}
                        initialClientId={clientId}
                        initialDate={s.plannedDate ?? undefined}
                        initialDuration={
                          s.plannedMinutes
                            ? Math.max(15, Math.round(s.plannedMinutes / 15) * 15)
                            : undefined
                        }
                        treatmentSessionId={s.id}
                        fixedClinicId={clinicId}
                        trigger={
                          <Button size="sm" variant="outline">
                            <CalendarPlus className="mr-1 size-3.5" />
                            Agendar
                          </Button>
                        }
                      />
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
