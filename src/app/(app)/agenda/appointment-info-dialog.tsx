"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  APPOINTMENT_STATUSES,
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_TYPE_LABELS,
  type AppointmentStatus,
} from "@/lib/appointments";
import { PHASE_LABELS, PILLAR_LABELS, displayedPillar } from "@/lib/journey";
import { cn } from "@/lib/utils";
import {
  getAppointmentParticipants,
  getAppointmentSessionOptions,
  updateAppointmentStatus,
  type PendingSession,
} from "./actions";
import { STATUS_DOT, type AgendaAppointment } from "./week-grid";

// Cada situação com sua cor (borda + texto), consistente com os blocos da agenda.
const STATUS_BTN: Record<AppointmentStatus, string> = {
  scheduled: "border-sky-300 text-sky-700 hover:bg-sky-50",
  confirmed: "border-emerald-300 text-emerald-700 hover:bg-emerald-50",
  completed: "border-zinc-300 text-zinc-700 hover:bg-zinc-100",
  cancelled: "border-red-300 text-red-700 hover:bg-red-50",
  no_show: "border-orange-300 text-orange-700 hover:bg-orange-50",
};

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
  canManage = false,
}: {
  appointment: AgendaAppointment;
  trigger: React.ReactElement<Record<string, unknown>>;
  /** H2.11: Recepção/Gerente/Admin podem alterar a situação por aqui. */
  canManage?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // H1.5/H2.12: sessões do tratamento vinculadas — carregadas ao abrir.
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<PendingSession[] | null>(null);
  // H4.7: profissionais adicionais (atendimento conjunto).
  const [participants, setParticipants] = useState<
    { userId: string; name: string }[] | null
  >(null);

  function changeStatus(status: AppointmentStatus) {
    startTransition(async () => {
      const result = await updateAppointmentStatus(appointment.id, status);
      if (result.ok) {
        toast.success(
          `Situação alterada para "${APPOINTMENT_STATUS_LABELS[status]}".`
        );
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }
  useEffect(() => {
    if (!open || sessions !== null) return;
    let cancelled = false;
    getAppointmentSessionOptions(appointment.id).then((r) => {
      if (!cancelled) setSessions(r.linked);
    });
    getAppointmentParticipants(appointment.id).then((r) => {
      if (!cancelled) setParticipants(r);
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
            label={
              participants && participants.length > 0
                ? "Responsável principal"
                : "Profissional"
            }
            value={appointment.provider?.full_name ?? "—"}
          />
          {participants && participants.length > 0 && (
            <Row
              label="Atendimento conjunto"
              value={
                <span className="text-right">
                  {participants.map((p) => p.name).join(", ")}
                </span>
              }
            />
          )}
          <Row
            label="Situação"
            value={
              <span className="inline-flex items-center gap-1.5">
                <span
                  className={cn(
                    "size-2 rounded-full",
                    STATUS_DOT[appointment.status]
                  )}
                />
                {APPOINTMENT_STATUS_LABELS[appointment.status]}
              </span>
            }
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
          {canManage && (
            <div className="mt-2 border-t pt-2">
              <p className="mb-1 text-xs text-muted-foreground">
                Alterar situação (ex.: cancelar, faltou)
              </p>
              <div className="flex flex-wrap gap-1">
                {APPOINTMENT_STATUSES.filter(
                  (st) => st !== appointment.status
                ).map((st) => (
                  <Button
                    key={st}
                    size="sm"
                    variant="outline"
                    className={cn("h-7 gap-1.5 px-2 text-xs", STATUS_BTN[st])}
                    disabled={isPending}
                    onClick={() => changeStatus(st)}
                  >
                    <span
                      className={cn("size-2 rounded-full", STATUS_DOT[st])}
                    />
                    {APPOINTMENT_STATUS_LABELS[st]}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
