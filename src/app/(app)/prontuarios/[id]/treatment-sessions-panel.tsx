"use client";

import { CalendarCheck, CalendarPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AppointmentFormDialog } from "../../agenda/appointment-form-dialog";
import { AppointmentInfoDialog } from "../../agenda/appointment-info-dialog";
import type { AgendaAppointment } from "../../agenda/week-grid";
import type { AgendaFormConfig } from "../../agenda/actions";
import type { StaffOption } from "@/lib/appointments";

export type TreatmentSession = {
  id: string;
  procedureName: string;
  sessionIndex: number;
  sessionTotal: number;
  name: string | null;
  plannedMinutes: number | null;
  actualMinutes: number | null;
  status: "pending" | "scheduled" | "done";
  /** H3.14: agendamento vinculado (quando/quem) — permite abrir os detalhes. */
  appointment: AgendaAppointment | null;
};

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
