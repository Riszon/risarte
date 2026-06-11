"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  APPOINTMENT_STATUSES,
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_TYPE_LABELS,
  type AppointmentStatus,
  type AppointmentType,
} from "@/lib/appointments";
import {
  PHASE_LABELS,
  PILLAR_LABELS,
  type JourneyPhase,
  type MethodologyPillar,
} from "@/lib/journey";
import { updateAppointmentStatus } from "./actions";

export type AgendaAppointment = {
  id: string;
  type: AppointmentType;
  status: AppointmentStatus;
  starts_at: string;
  ends_at: string;
  notes: string | null;
  clients: {
    id: string;
    full_name: string;
    journey_phase: JourneyPhase;
    methodology_pillar: MethodologyPillar | null;
  } | null;
};

const WEEKDAY_LABELS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

const STATUS_STYLES: Record<AppointmentStatus, string> = {
  scheduled: "",
  confirmed: "border-l-4 border-l-primary",
  completed: "opacity-60",
  cancelled: "opacity-40 line-through",
  no_show: "border-l-4 border-l-destructive",
};

export function WeekGrid({
  weekStartIso,
  appointments,
  canManage,
}: {
  weekStartIso: string;
  appointments: AgendaAppointment[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const weekStart = new Date(weekStartIso);
  const today = new Date();

  function setStatus(appointment: AgendaAppointment, status: AppointmentStatus) {
    startTransition(async () => {
      const result = await updateAppointmentStatus(appointment.id, status);
      if (result.ok) {
        toast.success(
          `Status alterado para ${APPOINTMENT_STATUS_LABELS[status]}.`
        );
        router.refresh();
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + i);
    return date;
  });

  return (
    <div className="grid min-w-[980px] grid-cols-7 gap-2">
      {days.map((date, i) => {
        const isToday = date.toDateString() === today.toDateString();
        const dayAppointments = appointments.filter(
          (a) => new Date(a.starts_at).toDateString() === date.toDateString()
        );

        return (
          <div
            key={i}
            className={cn(
              "flex flex-col rounded-lg border bg-muted/40",
              isToday && "border-primary"
            )}
          >
            <div
              className={cn(
                "border-b px-2 py-1.5 text-center text-sm",
                isToday && "bg-primary text-primary-foreground rounded-t-lg"
              )}
            >
              <span className="font-medium">{WEEKDAY_LABELS[i]}</span>{" "}
              <span className={isToday ? "" : "text-muted-foreground"}>
                {date.toLocaleDateString("pt-BR", {
                  day: "2-digit",
                  month: "2-digit",
                })}
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-1.5 p-1.5">
              {dayAppointments.map((appointment) => (
                <div
                  key={appointment.id}
                  className={cn(
                    "rounded-md border bg-card p-2 text-xs shadow-sm",
                    STATUS_STYLES[appointment.status]
                  )}
                >
                  <p className="font-medium">
                    {new Date(appointment.starts_at).toLocaleTimeString(
                      "pt-BR",
                      { hour: "2-digit", minute: "2-digit" }
                    )}{" "}
                    — {APPOINTMENT_TYPE_LABELS[appointment.type]}
                  </p>
                  {appointment.clients && (
                    <>
                      <Link
                        href={`/clientes/${appointment.clients.id}`}
                        className="mt-0.5 block truncate hover:underline"
                      >
                        {appointment.clients.full_name}
                      </Link>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge variant="secondary" className="text-[10px]">
                          {PHASE_LABELS[appointment.clients.journey_phase]}
                        </Badge>
                        <Badge
                          className={cn(
                            "text-[10px]",
                            appointment.clients.methodology_pillar
                              ? "bg-gold text-gold-foreground"
                              : "bg-muted text-muted-foreground"
                          )}
                        >
                          {appointment.clients.methodology_pillar
                            ? PILLAR_LABELS[
                                appointment.clients.methodology_pillar
                              ]
                            : "Pilar a definir"}
                        </Badge>
                      </div>
                    </>
                  )}
                  <div className="mt-1.5 flex items-center justify-between gap-1">
                    <span className="text-[10px] text-muted-foreground">
                      {APPOINTMENT_STATUS_LABELS[appointment.status]}
                    </span>
                    {canManage && (
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={isPending}
                              className="h-5 px-1.5 text-[10px]"
                            >
                              Alterar
                            </Button>
                          }
                        />
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuGroup>
                            <DropdownMenuLabel>Status</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            {APPOINTMENT_STATUSES.filter(
                              (s) => s !== appointment.status
                            ).map((status) => (
                              <DropdownMenuItem
                                key={status}
                                onClick={() => setStatus(appointment, status)}
                              >
                                {APPOINTMENT_STATUS_LABELS[status]}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </div>
              ))}
              {dayAppointments.length === 0 && (
                <p className="py-3 text-center text-[10px] text-muted-foreground">
                  —
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
