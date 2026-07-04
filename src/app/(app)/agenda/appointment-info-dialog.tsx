"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_TYPE_LABELS,
} from "@/lib/appointments";
import { PHASE_LABELS, PILLAR_LABELS, displayedPillar } from "@/lib/journey";
import { getAppointmentSessionOptions, type PendingSession } from "./actions";
import type { AgendaAppointment } from "./week-grid";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

/**
 * Read-only details of an appointment (GR2): opened from a card's info icon,
 * so the user can see everything without entering edit mode.
 */
export function AppointmentInfoDialog({
  appointment,
  trigger,
}: {
  appointment: AgendaAppointment;
  trigger: React.ReactElement<Record<string, unknown>>;
}) {
  // H1.5/H2.12: sessões do tratamento vinculadas — carregadas ao abrir.
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<PendingSession[] | null>(null);
  useEffect(() => {
    if (!open || sessions !== null) return;
    let cancelled = false;
    getAppointmentSessionOptions(appointment.id).then((r) => {
      if (!cancelled) setSessions(r.linked);
    });
    return () => {
      cancelled = true;
    };
  }, [open, sessions, appointment.id]);

  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  const date = new Date(appointment.starts_at).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const local = appointment.is_online
    ? "ONLINE"
    : (appointment.room_name ?? "—");
  const pillar = appointment.clients
    ? displayedPillar(
        appointment.clients.journey_phase,
        appointment.clients.methodology_pillar
      )
    : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {appointment.clients?.full_name ?? "Agendamento"}
          </DialogTitle>
        </DialogHeader>
        <div className="text-sm">
          <Row label="Data" value={<span className="capitalize">{date}</span>} />
          <Row
            label="Horário"
            value={`${time(appointment.starts_at)} – ${time(appointment.ends_at)}`}
          />
          <Row label="Tipo" value={APPOINTMENT_TYPE_LABELS[appointment.type]} />
          <Row label="Local" value={local} />
          <Row
            label="Profissional"
            value={appointment.provider?.full_name ?? "—"}
          />
          <Row
            label="Situação"
            value={APPOINTMENT_STATUS_LABELS[appointment.status]}
          />
          {appointment.clients && (
            <Row
              label="Fase / Pilar"
              value={`${PHASE_LABELS[appointment.clients.journey_phase]}${
                pillar ? ` · ${PILLAR_LABELS[pillar]}` : ""
              }`}
            />
          )}
          {appointment.needs_reschedule && (
            <p className="mt-1 rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-700">
              Precisa ser remarcado (agenda fechada no período).
            </p>
          )}
          {sessions !== null && sessions.length > 0 && (
            <div className="mt-2 border-t pt-2">
              <p className="text-xs text-muted-foreground">
                Sessões do tratamento neste agendamento
              </p>
              <ul className="mt-1 space-y-0.5">
                {sessions.map((s) => (
                  <li key={s.id} className="text-sm">
                    {s.label}
                    {s.minutes ? (
                      <span className="text-muted-foreground">
                        {" "}
                        · {s.minutes} min
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {appointment.notes && (
            <div className="mt-2 border-t pt-2">
              <p className="text-xs text-muted-foreground">Observações</p>
              <p className="text-sm">{appointment.notes}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
