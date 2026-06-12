"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, UserRound } from "lucide-react";
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
  type StaffOption,
} from "@/lib/appointments";
import {
  PHASE_LABELS,
  PILLAR_LABELS,
  type JourneyPhase,
  type MethodologyPillar,
} from "@/lib/journey";
import { updateAppointmentStatus } from "./actions";
import { AppointmentFormDialog } from "./appointment-form-dialog";

export type AgendaAppointment = {
  id: string;
  type: AppointmentType;
  status: AppointmentStatus;
  starts_at: string;
  ends_at: string;
  notes: string | null;
  provider_user_id: string | null;
  provider: { full_name: string } | null;
  clients: {
    id: string;
    full_name: string;
    journey_phase: JourneyPhase;
    methodology_pillar: MethodologyPillar | null;
  } | null;
};

const WEEKDAY_LABELS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

// One color per status, applied to the card's left border + background tint.
const STATUS_STYLES: Record<AppointmentStatus, string> = {
  scheduled: "border-l-4 border-l-sky-400 bg-sky-50",
  confirmed: "border-l-4 border-l-emerald-500 bg-emerald-50",
  completed: "border-l-4 border-l-zinc-400 bg-zinc-100 opacity-75",
  cancelled: "border-l-4 border-l-red-400 bg-red-50 opacity-60",
  no_show: "border-l-4 border-l-orange-500 bg-orange-50",
};

const STATUS_DOT: Record<AppointmentStatus, string> = {
  scheduled: "bg-sky-400",
  confirmed: "bg-emerald-500",
  completed: "bg-zinc-400",
  cancelled: "bg-red-400",
  no_show: "bg-orange-500",
};

export function WeekGrid({
  weekStartIso,
  appointments,
  canManage,
  staff,
}: {
  weekStartIso: string;
  appointments: AgendaAppointment[];
  canManage: boolean;
  staff: StaffOption[];
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

  function renderCard(appointment: AgendaAppointment, compact: boolean) {
    const isUrgent =
      appointment.type === "urgency" || appointment.type === "emergency";
    return (
      <div
        key={appointment.id}
        className={cn(
          "rounded-md border p-2 text-xs shadow-sm",
          STATUS_STYLES[appointment.status],
          appointment.type === "urgency" &&
            "ring-2 ring-amber-400 border-l-amber-500",
          appointment.type === "emergency" &&
            "ring-2 ring-red-500 border-l-red-600"
        )}
      >
        {isUrgent && (
          <Badge
            className={cn(
              "mb-1 text-[10px] uppercase",
              appointment.type === "emergency"
                ? "bg-red-600 text-white"
                : "bg-amber-500 text-white"
            )}
          >
            {APPOINTMENT_TYPE_LABELS[appointment.type]} · encaixe
          </Badge>
        )}
        <p
          className={cn(
            "font-medium",
            appointment.status === "cancelled" && "line-through"
          )}
        >
          {new Date(appointment.starts_at).toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
          })}
          –
          {new Date(appointment.ends_at).toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
          })}{" "}
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
            {appointment.provider && (
              <p className="mt-0.5 flex items-center gap-1 truncate text-[10px] text-muted-foreground">
                <UserRound className="size-3 shrink-0" />
                {appointment.provider.full_name}
              </p>
            )}
            {!compact && (
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
                    ? PILLAR_LABELS[appointment.clients.methodology_pillar]
                    : "Pilar a definir"}
                </Badge>
              </div>
            )}
          </>
        )}
        <div className="mt-1.5 flex items-center justify-between gap-1">
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <span
              className={cn(
                "size-2 rounded-full",
                STATUS_DOT[appointment.status]
              )}
            />
            {APPOINTMENT_STATUS_LABELS[appointment.status]}
          </span>
          {canManage && (
            <div className="flex items-center">
              <AppointmentFormDialog
                clients={[]}
                staff={staff}
                appointment={{
                  id: appointment.id,
                  type: appointment.type,
                  starts_at: appointment.starts_at,
                  ends_at: appointment.ends_at,
                  provider_user_id: appointment.provider_user_id,
                  notes: appointment.notes,
                  clientName: appointment.clients?.full_name ?? "",
                }}
                trigger={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 px-1"
                    aria-label="Editar agendamento"
                  >
                    <Pencil className="size-3" />
                  </Button>
                }
              />
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={isPending}
                      className="h-5 px-1.5 text-[10px]"
                    >
                      Status
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
                        <span
                          className={cn(
                            "mr-1.5 size-2 rounded-full",
                            STATUS_DOT[status]
                          )}
                        />
                        {APPOINTMENT_STATUS_LABELS[status]}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Color legend */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        {APPOINTMENT_STATUSES.map((status) => (
          <span key={status} className="inline-flex items-center gap-1">
            <span className={cn("size-2 rounded-full", STATUS_DOT[status])} />
            {APPOINTMENT_STATUS_LABELS[status]}
          </span>
        ))}
      </div>

      <div className="grid min-w-[980px] grid-cols-7 gap-2">
        {days.map((date, i) => {
          const isToday = date.toDateString() === today.toDateString();
          const dayAppointments = appointments.filter(
            (a) => new Date(a.starts_at).toDateString() === date.toDateString()
          );

          // Same start time => side by side on the same level.
          const groups = new Map<string, AgendaAppointment[]>();
          for (const appointment of dayAppointments) {
            const key = appointment.starts_at;
            const list = groups.get(key) ?? [];
            list.push(appointment);
            groups.set(key, list);
          }
          const orderedGroups = [...groups.entries()].sort(([a], [b]) =>
            a.localeCompare(b)
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
                {orderedGroups.map(([key, group]) =>
                  group.length === 1 ? (
                    renderCard(group[0], false)
                  ) : (
                    <div
                      key={key}
                      className="grid grid-cols-2 gap-1 rounded-md border border-dashed p-1"
                    >
                      {group.map((appointment) =>
                        renderCard(appointment, true)
                      )}
                    </div>
                  )
                )}
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
    </div>
  );
}
