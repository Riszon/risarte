"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  DoorOpen,
  Info,
  Pencil,
  UserRound,
  Users,
  Wifi,
} from "lucide-react";
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
  type AttendanceStatus,
  type StaffOption,
} from "@/lib/appointments";
import {
  PHASE_LABELS,
  PILLAR_LABELS,
  displayedPillar,
  type JourneyPhase,
  type MethodologyPillar,
} from "@/lib/journey";
import { updateAppointmentStatus, type AgendaFormConfig } from "./actions";
import { AppointmentFormDialog } from "./appointment-form-dialog";
import { AppointmentInfoDialog } from "./appointment-info-dialog";

export type AgendaAppointment = {
  id: string;
  type: AppointmentType;
  status: AppointmentStatus;
  starts_at: string;
  ends_at: string;
  notes: string | null;
  provider_user_id: string | null;
  provider: { full_name: string } | null;
  /** Room (chair) the client is attended in; ONLINE for commercial. */
  room_id?: string | null;
  room_name?: string | null;
  is_online?: boolean;
  /** Flagged when an agenda closure (G4) requires this appointment to be moved. */
  needs_reschedule?: boolean;
  /** Drives the intermediate label sync with the Atendimento screen. */
  attendance?: AttendanceStatus | null;
  /** Set only in the network (planner/franchisor) view. */
  clinic_name?: string | null;
  /** H3.7: false quando a SDR não pode abrir o prontuário deste cliente. */
  clientLinkable?: boolean;
  /** H4.7: nomes dos profissionais adicionais (atendimento conjunto). */
  participantNames?: string[];
  clients: {
    id: string;
    full_name: string;
    journey_phase: JourneyPhase;
    methodology_pillar: MethodologyPillar | null;
  } | null;
};

const WEEKDAY_LABELS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

// One color per status, applied to the card's left border + background tint.
export const STATUS_STYLES: Record<AppointmentStatus, string> = {
  scheduled: "border-l-4 border-l-sky-400 bg-sky-50",
  confirmed: "border-l-4 border-l-emerald-500 bg-emerald-50",
  completed: "border-l-4 border-l-zinc-400 bg-zinc-100 opacity-75",
  cancelled: "border-l-4 border-l-red-400 bg-red-50 opacity-60",
  no_show: "border-l-4 border-l-orange-500 bg-orange-50",
};

export const STATUS_DOT: Record<AppointmentStatus, string> = {
  scheduled: "bg-sky-400",
  confirmed: "bg-emerald-500",
  completed: "bg-zinc-400",
  cancelled: "bg-red-400",
  no_show: "bg-orange-500",
};

/** Status shown on the card, reflecting the attendance flow when in progress. */
export function displayedStatus(a: AgendaAppointment): {
  label: string;
  dot: string;
} {
  if (a.status === "completed" || a.attendance === "done") {
    return { label: "Realizado", dot: STATUS_DOT.completed };
  }
  if (a.attendance === "in_service") {
    return { label: "Em atendimento", dot: "bg-violet-500" };
  }
  if (a.attendance === "waiting") {
    return { label: "Aguardando atendimento", dot: "bg-amber-500" };
  }
  return {
    label: APPOINTMENT_STATUS_LABELS[a.status],
    dot: STATUS_DOT[a.status],
  };
}

/** H4.7: selo "Atendimento conjunto" nos cards da agenda, com a lista de
 * profissionais adicionais no title. Compartilhado por todas as visões. */
export function JointBadge({ names }: { names?: string[] }) {
  if (!names || names.length === 0) return null;
  return (
    <p
      className="mt-0.5 flex items-center gap-1 text-[10px] font-medium text-amber-700"
      title={`Atendimento conjunto — também: ${names.join(", ")}`}
    >
      <Users className="size-3 shrink-0" />
      <span className="truncate">
        Conjunto: {names.join(", ")}
      </span>
    </p>
  );
}

export function WeekGrid({
  weekStartIso,
  appointments,
  canManage,
  staff,
  config,
  highlightType,
  dayCount = 7,
  weekdays,
  openDayDates = [],
  holidayClosedDates = [],
  holidayOpenDates = [],
  holidays = [],
}: {
  weekStartIso: string;
  appointments: AgendaAppointment[];
  canManage: boolean;
  staff: StaffOption[];
  /** Rooms + working hours, passed to the edit dialog. */
  config?: AgendaFormConfig;
  /** Appointment type to highlight (e.g. commercial presentation for planner). */
  highlightType?: AppointmentType;
  /** Number of day columns (7 = week, 1 = single day). */
  dayCount?: number;
  /** Configured working weekdays (G5). When set, non-working days are hidden. */
  weekdays?: number[];
  openDayDates?: string[];
  holidayClosedDates?: string[];
  holidayOpenDates?: string[];
  holidays?: { date: string; name: string }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const weekStart = new Date(weekStartIso);
  const today = new Date();

  const openDaySet = new Set(openDayDates);
  const holidayClosedSet = new Set(holidayClosedDates);
  const holidayOpenSet = new Set(holidayOpenDates);
  const holidayNameByDate = new Map(holidays.map((h) => [h.date, h.name]));
  const isoOf = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

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

  const hasAppts = (date: Date) =>
    appointments.some(
      (a) => new Date(a.starts_at).toDateString() === date.toDateString()
    );

  const allDays = Array.from({ length: dayCount }, (_, i) => {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + i);
    return date;
  });

  // G5: when working weekdays are configured, hide days without attendance
  // (keeping special open days, holiday-open days, and any day with bookings).
  const days =
    weekdays && dayCount > 1
      ? allDays.filter((date) => {
          const iso = isoOf(date);
          if (holidayClosedSet.has(iso)) return hasAppts(date);
          if (weekdays.includes(date.getDay())) return true;
          if (openDaySet.has(iso) || holidayOpenSet.has(iso)) return true;
          return hasAppts(date);
        })
      : allDays;

  function renderCard(appointment: AgendaAppointment, compact: boolean) {
    const isUrgent =
      appointment.type === "urgency" || appointment.type === "emergency";
    const isHighlighted =
      highlightType !== undefined && appointment.type === highlightType;
    return (
      <div
        key={appointment.id}
        className={cn(
          "rounded-md border p-2 text-xs shadow-sm",
          STATUS_STYLES[appointment.status],
          isHighlighted && "ring-2 ring-gold border-l-gold",
          appointment.needs_reschedule && "ring-2 ring-red-500 border-l-red-600",
          appointment.type === "urgency" &&
            "ring-2 ring-amber-400 border-l-amber-500",
          appointment.type === "emergency" &&
            "ring-2 ring-red-500 border-l-red-600"
        )}
      >
        {appointment.needs_reschedule && (
          <Badge className="mb-1 gap-1 bg-red-600 text-[10px] uppercase text-white">
            <AlertTriangle className="size-3" />
            Remarcar — agenda fechada
          </Badge>
        )}
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
            {appointment.clientLinkable === false ? (
              <span
                className="mt-0.5 block truncate"
                title="Você não tem acesso ao prontuário deste cliente."
              >
                {appointment.clients.full_name}
              </span>
            ) : (
              <Link
                href={`/prontuarios/${appointment.clients.id}`}
                className="mt-0.5 block truncate hover:underline"
              >
                {appointment.clients.full_name}
              </Link>
            )}
            {appointment.clinic_name && (
              <p className="truncate text-[10px] font-medium text-primary">
                {appointment.clinic_name}
              </p>
            )}
            {appointment.provider && (
              <p className="mt-0.5 flex items-center gap-1 truncate text-[10px] text-muted-foreground">
                <UserRound className="size-3 shrink-0" />
                {appointment.provider.full_name}
              </p>
            )}
            <JointBadge names={appointment.participantNames} />
            {appointment.is_online ? (
              <p className="mt-0.5 flex items-center gap-1 truncate text-[10px] font-medium text-sky-700">
                <Wifi className="size-3 shrink-0" />
                ONLINE
              </p>
            ) : (
              appointment.room_name && (
                <p className="mt-0.5 flex items-center gap-1 truncate text-[10px] text-muted-foreground">
                  <DoorOpen className="size-3 shrink-0" />
                  {appointment.room_name}
                </p>
              )
            )}
            {!compact &&
              (() => {
                const pillar = displayedPillar(
                  appointment.clients.journey_phase,
                  appointment.clients.methodology_pillar
                );
                return (
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Badge variant="secondary" className="text-[10px]">
                      {PHASE_LABELS[appointment.clients.journey_phase]}
                    </Badge>
                    <Badge
                      className={cn(
                        "text-[10px]",
                        pillar
                          ? "bg-gold text-gold-foreground"
                          : "bg-muted text-muted-foreground"
                      )}
                    >
                      {pillar ? PILLAR_LABELS[pillar] : "Pilar a definir"}
                    </Badge>
                  </div>
                );
              })()}
          </>
        )}
        <div className="mt-1.5 flex items-center justify-between gap-1">
          {(() => {
            const ds = displayedStatus(appointment);
            return (
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                <span className={cn("size-2 rounded-full", ds.dot)} />
                {ds.label}
              </span>
            );
          })()}
          <div className="flex items-center">
            <AppointmentInfoDialog
              appointment={appointment}
              trigger={
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 px-1"
                  aria-label="Ver informações"
                >
                  <Info className="size-3" />
                </Button>
              }
            />
            {canManage && (
              <>
              {/* Past appointments cannot be edited — only the status. */}
              {new Date(appointment.starts_at).getTime() >= today.getTime() && (
                <AppointmentFormDialog
                  clients={[]}
                  staff={staff}
                  config={config}
                  appointment={{
                    id: appointment.id,
                    type: appointment.type,
                    starts_at: appointment.starts_at,
                    ends_at: appointment.ends_at,
                    provider_user_id: appointment.provider_user_id,
                    notes: appointment.notes,
                    room_id: appointment.room_id ?? null,
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
              )}
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
              </>
            )}
          </div>
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

      {days.length === 0 ? (
        <p className="rounded-lg border bg-muted/40 p-6 text-center text-sm text-muted-foreground">
          Nenhum dia de atendimento neste período.
        </p>
      ) : (
      <div
        className="grid gap-2"
        style={{
          minWidth: days.length > 1 ? Math.max(280, days.length * 140) : 280,
          gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
        }}
      >
        {days.map((date, i) => {
          const isToday = date.toDateString() === today.toDateString();
          const iso = isoOf(date);
          const holidayName = holidayNameByDate.get(iso);
          const holidayClosed = holidayClosedSet.has(iso);
          const isSpecialOpen = openDaySet.has(iso);
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
                <span className="font-medium">
                  {WEEKDAY_LABELS[(date.getDay() + 6) % 7]}
                </span>{" "}
                <span className={isToday ? "" : "text-muted-foreground"}>
                  {date.toLocaleDateString("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                  })}
                </span>
                {holidayName && (
                  <span
                    className={cn(
                      "mt-0.5 block truncate text-[10px]",
                      isToday ? "text-primary-foreground/90" : "text-red-700"
                    )}
                    title={holidayName}
                  >
                    🎌 {holidayName}
                    {holidayClosed ? " (fechado)" : ""}
                  </span>
                )}
                {isSpecialOpen && !holidayName && (
                  <span className="mt-0.5 block text-[10px] text-emerald-700">
                    Dia avulso liberado
                  </span>
                )}
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
      )}
    </div>
  );
}
