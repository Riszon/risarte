"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Info, Lock, Pencil, UserRound, Wifi } from "lucide-react";
import { cn } from "@/lib/utils";
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
import {
  APPOINTMENT_STATUSES,
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_TYPE_LABELS,
  type AppointmentStatus,
  type StaffOption,
} from "@/lib/appointments";
import {
  decideHoliday,
  updateAppointment,
  updateAppointmentStatus,
  type AgendaFormConfig,
} from "./actions";
import {
  CLOSURE_REASON_LABELS,
  CLOSURE_SCOPE_LABELS,
  type AgendaClosure,
} from "@/lib/closures";
import { AppointmentFormDialog } from "./appointment-form-dialog";
import { AppointmentInfoDialog } from "./appointment-info-dialog";
import { ClosureControls } from "./closure-controls";
import {
  JointBadge,
  STATUS_STYLES,
  STATUS_DOT,
  displayedStatus,
  type AgendaAppointment,
} from "./week-grid";

const SLOT_MIN = 15; // 15-minute granularity (ticks).
const SLOT_PX = 18; // height of one 15-min slot.
const PX_PER_MIN = SLOT_PX / SLOT_MIN;
const AXIS_W = 56; // left time ruler width.
const COL_MIN_W = 150;
// AJ9: respiro no topo para o primeiro horário não colar no cabeçalho.
const TOP_PAD_PX = 12;

type DayColumn = {
  key: string;
  label: string;
  isOnline?: boolean;
  isNoRoom?: boolean;
};

function localMinutes(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

function minutesToHHMM(m: number): string {
  const mm = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(mm / 60)).padStart(2, "0")}:${String(mm % 60).padStart(2, "0")}`;
}

/** Greedy lane layout so overlapping appointments (encaixe) sit side by side. */
function assignLanes(appts: AgendaAppointment[]) {
  const sorted = [...appts].sort(
    (a, b) => localMinutes(a.starts_at) - localMinutes(b.starts_at)
  );
  const laneEnds: number[] = [];
  const laneOf = new Map<string, number>();
  for (const a of sorted) {
    const s = localMinutes(a.starts_at);
    let e = localMinutes(a.ends_at);
    if (e <= s) e = 24 * 60;
    let placed = false;
    for (let i = 0; i < laneEnds.length; i++) {
      if (laneEnds[i] <= s) {
        laneEnds[i] = e;
        laneOf.set(a.id, i);
        placed = true;
        break;
      }
    }
    if (!placed) {
      laneOf.set(a.id, laneEnds.length);
      laneEnds.push(e);
    }
  }
  return { laneOf, laneCount: Math.max(1, laneEnds.length) };
}

/**
 * Day view (G3.1): rooms as columns with a vertical time ruler (hour labels +
 * 15-min ticks). Appointments are positioned by their start time inside the
 * room column; overlaps (encaixe) sit side by side. ONLINE gets its own column.
 */
export function DayRoomGrid({
  dateIso,
  appointments,
  rooms,
  selectedSalas = [],
  unitHasRooms = true,
  openTime,
  closeTime,
  canManage,
  staff,
  clients,
  config,
  closures = [],
  canManageClosures = false,
  holidayName = null,
  holidayDecision = null,
  dayOpen = true,
  canDecideHoliday = false,
  isSpecialOpenDay = false,
  planBlockLabel = null,
  clinicId,
}: {
  dateIso: string;
  appointments: AgendaAppointment[];
  /** Rooms shown as columns (already filtered by the page). */
  rooms: { id: string; name: string }[];
  /** Active room filter (drives the empty-state message). */
  selectedSalas?: string[];
  /** Whether the unit has any rooms configured at all. */
  unitHasRooms?: boolean;
  openTime: string;
  closeTime: string;
  canManage: boolean;
  staff: StaffOption[];
  /** Clients for quick scheduling (clicking an empty slot). */
  clients?: { id: string; full_name: string; inactive?: boolean }[];
  config?: AgendaFormConfig;
  /** Agenda closures (G4) overlapping the visible day. */
  closures?: AgendaClosure[];
  /** Whether the viewer can remove closures. */
  canManageClosures?: boolean;
  /** Holiday on this day (G5), if any, and the manager's decision. */
  holidayName?: string | null;
  holidayDecision?: boolean | null;
  /** Whether the unit attends on this day (working/special/holiday-open). */
  dayOpen?: boolean;
  /** Whether the viewer (manager) can confirm holidays. */
  canDecideHoliday?: boolean;
  /** Whether this day is a special open day (G5/GR4) — shown in destaque. */
  isSpecialOpenDay?: boolean;
  /** Annual-plan block label (GR6) when the day is closed by the plan. */
  planBlockLabel?: string | null;
  clinicId?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const today = new Date();
  const day = new Date(dateIso);
  const dayIso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  const dayStartMs = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate()
  ).getTime();
  const roomNameById = new Map(
    (config?.rooms ?? rooms).map((r) => [r.id, r.name])
  );
  // Quick scheduling: clicking an empty slot opens the dialog pre-filled.
  const [quick, setQuick] = useState<{
    date: string;
    time: string;
    roomId: string;
  } | null>(null);
  const canQuickCreate = canManage && Boolean(clients);

  // Drag-to-reschedule (G3.3): a future card can be dragged to a new slot/room.
  const [dragAppt, setDragAppt] = useState<AgendaAppointment | null>(null);
  // Where the dragged card would land (GR2: clear visual feedback).
  const [dragOver, setDragOver] = useState<{ col: string; time: string } | null>(
    null
  );

  function setStatus(appointment: AgendaAppointment, status: AppointmentStatus) {
    startTransition(async () => {
      const result = await updateAppointmentStatus(appointment.id, status);
      if (result.ok) {
        toast.success(`Status alterado para ${APPOINTMENT_STATUS_LABELS[status]}.`);
        router.refresh();
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

  function reschedule(
    appointment: AgendaAppointment,
    roomId: string,
    time: string
  ) {
    const startMs = new Date(appointment.starts_at).getTime();
    const endMs = new Date(appointment.ends_at).getTime();
    const durationMin = Math.max(15, Math.round((endMs - startMs) / 60_000));
    const fd = new FormData();
    fd.set("type", appointment.type);
    fd.set("date", dayIso);
    fd.set("time", time);
    fd.set("duration", String(durationMin));
    fd.set("provider_user_id", appointment.provider_user_id ?? "");
    fd.set("notes", appointment.notes ?? "");
    fd.set("room_id", roomId);
    startTransition(async () => {
      const result = await updateAppointment(appointment.id, fd);
      if (result.ok) {
        toast.success("Agendamento remarcado.");
        router.refresh();
      } else {
        toast.error(result.error ?? "Não foi possível remarcar.");
      }
    });
  }

  function slotTimeFromEvent(e: React.MouseEvent | React.DragEvent): string {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    let minute = winStart + (y - TOP_PAD_PX) / PX_PER_MIN;
    minute = Math.round(minute / SLOT_MIN) * SLOT_MIN;
    minute = Math.max(winStart, Math.min(winEnd - SLOT_MIN, minute));
    return minutesToHHMM(minute);
  }

  function decideHolidayDay(willAttend: boolean) {
    if (!clinicId) return;
    startTransition(async () => {
      const result = await decideHoliday(clinicId, dayIso, willAttend);
      if (result.ok) {
        toast.success(
          willAttend
            ? "Feriado confirmado com atendimento."
            : "Feriado confirmado sem atendimento."
        );
        router.refresh();
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

  const staffNameById = new Map(staff.map((s) => [s.userId, s.name]));

  /** Closures that block a given room column (whole-unit or that room). */
  function closuresForColumn(roomId: string): AgendaClosure[] {
    return closures.filter(
      (c) => c.scope === "unit" || (c.scope === "rooms" && c.roomIds.includes(roomId))
    );
  }

  /** The closure blocking a column at a given time (HH:MM), if any. */
  function blockingClosureAt(roomId: string, time: string): AgendaClosure | null {
    const startMs = new Date(`${dayIso}T${time}:00`).getTime();
    const endMs = startMs + SLOT_MIN * 60_000;
    for (const c of closuresForColumn(roomId)) {
      const cs = new Date(c.startsAt).getTime();
      const ce = new Date(c.endsAt).getTime();
      if (startMs < ce && endMs > cs) return c;
    }
    return null;
  }

  function closureTimeLabel(c: AgendaClosure): string {
    const fmt = (iso: string) =>
      new Date(iso).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    return `${fmt(c.startsAt)} → ${fmt(c.endsAt)}`;
  }

  // Columns: shown rooms, plus ONLINE / "Sem sala" when such appointments exist.
  const hasOnline = appointments.some((a) => a.is_online);
  const roomIds = new Set(rooms.map((r) => r.id));
  const hasNoRoom = appointments.some(
    (a) => !a.is_online && (!a.room_id || !roomIds.has(a.room_id))
  );
  const columns: DayColumn[] = [
    ...rooms.map((r) => ({ key: r.id, label: r.name })),
    ...(hasOnline ? [{ key: "__online", label: "ONLINE", isOnline: true }] : []),
    ...(hasNoRoom
      ? [{ key: "__noroom", label: "Sem sala", isNoRoom: true }]
      : []),
  ];

  function columnKeyFor(a: AgendaAppointment): string {
    if (a.is_online) return "__online";
    if (a.room_id && roomIds.has(a.room_id)) return a.room_id;
    return "__noroom";
  }

  // Time window: configured hours, expanded to fit any appointment (encaixe).
  let winStart = timeToMin(openTime);
  let winEnd = timeToMin(closeTime);
  for (const a of appointments) {
    const s = localMinutes(a.starts_at);
    let e = localMinutes(a.ends_at);
    if (e <= s) e = 24 * 60;
    winStart = Math.min(winStart, s);
    winEnd = Math.max(winEnd, e);
  }
  // Expand the window to also show closures of the day.
  for (const c of closures) {
    const cs = Math.max(new Date(c.startsAt).getTime(), dayStartMs);
    const ce = Math.min(new Date(c.endsAt).getTime(), dayStartMs + 86_400_000);
    if (ce <= cs) continue;
    winStart = Math.min(winStart, (cs - dayStartMs) / 60_000);
    winEnd = Math.max(winEnd, (ce - dayStartMs) / 60_000);
  }
  winStart = Math.floor(winStart / 60) * 60;
  winEnd = Math.ceil(winEnd / 60) * 60;
  if (winEnd <= winStart) winEnd = winStart + 60;
  const totalMin = winEnd - winStart;
  const totalPx = totalMin * PX_PER_MIN;

  const hourLines: number[] = [];
  for (let h = winStart; h <= winEnd; h += 60) hourLines.push(h);

  const columnBg = {
    backgroundImage: `repeating-linear-gradient(to bottom, rgba(0,0,0,0.05) 0, rgba(0,0,0,0.05) 1px, transparent 1px, transparent ${SLOT_PX}px), repeating-linear-gradient(to bottom, rgba(0,0,0,0.14) 0, rgba(0,0,0,0.14) 1px, transparent 1px, transparent ${SLOT_PX * 4}px)`,
  };

  function renderClosureOverlay(closure: AgendaClosure) {
    const cs = Math.max(new Date(closure.startsAt).getTime(), dayStartMs);
    const ce = Math.min(new Date(closure.endsAt).getTime(), dayStartMs + 86_400_000);
    if (ce <= cs) return null;
    const startMin = clamp((cs - dayStartMs) / 60_000, winStart, winEnd);
    const endMin = clamp((ce - dayStartMs) / 60_000, winStart, winEnd);
    const top = TOP_PAD_PX + (startMin - winStart) * PX_PER_MIN;
    const height = Math.max(10, (endMin - startMin) * PX_PER_MIN);
    return (
      <div
        key={closure.id}
        className="pointer-events-none absolute inset-x-0 z-[1] flex items-start justify-center overflow-hidden rounded-sm border border-red-300/70 text-[9px] font-medium text-red-700"
        style={{
          top,
          height,
          backgroundImage:
            "repeating-linear-gradient(45deg, rgba(220,38,38,0.14) 0, rgba(220,38,38,0.14) 6px, rgba(220,38,38,0.04) 6px, rgba(220,38,38,0.04) 12px)",
        }}
      >
        <span className="mt-0.5 inline-flex items-center gap-0.5 rounded bg-red-600/90 px-1 text-white">
          <Lock className="size-2.5" />
          {CLOSURE_REASON_LABELS[closure.reason]}
        </span>
      </div>
    );
  }

  function renderLunchBand() {
    if (!config?.lunchEnabled) return null;
    const s = clamp(timeToMin(config.lunchStart), winStart, winEnd);
    const e = clamp(timeToMin(config.lunchEnd), winStart, winEnd);
    if (e <= s) return null;
    const top = TOP_PAD_PX + (s - winStart) * PX_PER_MIN;
    const height = Math.max(8, (e - s) * PX_PER_MIN);
    return (
      <div
        className="pointer-events-none absolute inset-x-0 z-[1] flex items-start justify-center overflow-hidden border-y border-amber-200 bg-amber-100/50 text-[9px] font-medium text-amber-700"
        style={{ top, height }}
      >
        <span className="mt-0.5">Almoço</span>
      </div>
    );
  }

  // AJ8: marca em cinza tracejado os horários FORA do expediente normal (antes
  // da abertura / depois do fechamento), como o almoço é marcado em âmbar.
  function renderOutsideBands() {
    const openMin = timeToMin(openTime);
    const closeMin = timeToMin(closeTime);
    const bands: React.ReactNode[] = [];
    const push = (from: number, to: number, key: string) => {
      const s = clamp(from, winStart, winEnd);
      const e = clamp(to, winStart, winEnd);
      if (e <= s) return;
      bands.push(
        <div
          key={key}
          className="pointer-events-none absolute inset-x-0 z-[1] border-y border-slate-200"
          style={{
            top: TOP_PAD_PX + (s - winStart) * PX_PER_MIN,
            height: Math.max(4, (e - s) * PX_PER_MIN),
            backgroundImage:
              "repeating-linear-gradient(45deg, rgba(100,116,139,0.13) 0, rgba(100,116,139,0.13) 6px, transparent 6px, transparent 12px)",
          }}
          title="Fora do horário normal de atendimento"
        />
      );
    };
    push(winStart, openMin, "before-open");
    push(closeMin, winEnd, "after-close");
    return bands;
  }

  if (columns.length === 0) {
    const onlyOnlineFilter =
      selectedSalas.includes("online") &&
      !selectedSalas.some((s) => s !== "online");
    let message: string;
    if (onlyOnlineFilter) {
      message =
        "Nenhuma apresentação online (ONLINE) agendada neste dia. Quando houver, ela aparece aqui.";
    } else if (!unitHasRooms) {
      message =
        "Esta unidade ainda não tem salas cadastradas. Cadastre em “Configurar agenda”.";
    } else {
      message =
        "Nenhuma sala selecionada para exibir. Ajuste o filtro de salas acima.";
    }
    return (
      <p className="rounded-lg border bg-muted/40 p-6 text-center text-sm text-muted-foreground">
        {message}
      </p>
    );
  }

  function renderAppointment(
    appointment: AgendaAppointment,
    laneIndex: number,
    laneCount: number
  ) {
    const s = clamp(localMinutes(appointment.starts_at), winStart, winEnd);
    let endMin = localMinutes(appointment.ends_at);
    if (endMin <= localMinutes(appointment.starts_at)) endMin = 24 * 60;
    const e = clamp(endMin, winStart, winEnd);
    const top = TOP_PAD_PX + (s - winStart) * PX_PER_MIN;
    const height = Math.max(16, (e - s) * PX_PER_MIN);
    const widthPct = 100 / laneCount;
    const ds = displayedStatus(appointment);
    const isFuture =
      new Date(appointment.starts_at).getTime() >= today.getTime();
    // H2.8: agendamento curto (15 min) vira card compacto de UMA linha com o
    // nome do cliente visível (status/edição continuam pelo pop-up "i").
    const compact = height < 40;

    const draggable = canManage && isFuture;
    return (
      <div
        key={appointment.id}
        onClick={(e) => e.stopPropagation()}
        draggable={draggable}
        onDragStart={
          draggable
            ? (e) => {
                setDragAppt(appointment);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", appointment.id);
              }
            : undefined
        }
        onDragEnd={() => {
          setDragAppt(null);
          setDragOver(null);
        }}
        className={cn(
          "absolute overflow-hidden rounded-md border shadow-sm",
          compact
            ? "flex items-center px-1 text-[10px]"
            : "px-1.5 py-1 text-[11px]",
          STATUS_STYLES[appointment.status],
          draggable && "cursor-grab active:cursor-grabbing",
          appointment.needs_reschedule && "ring-2 ring-red-500",
          appointment.type === "urgency" && "ring-1 ring-amber-400",
          appointment.type === "emergency" && "ring-1 ring-red-500"
        )}
        style={{
          top,
          height,
          left: `calc(${laneIndex * widthPct}% + 1px)`,
          width: `calc(${widthPct}% - 2px)`,
        }}
      >
        <div
          className={cn(
            "flex items-center gap-1",
            compact ? "min-w-0 flex-1" : "justify-between"
          )}
        >
          <span className="flex shrink-0 items-center gap-1 font-medium">
            {appointment.needs_reschedule && (
              <AlertTriangle className="size-3 shrink-0 text-red-600" />
            )}
            {new Date(appointment.starts_at).toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          {compact && appointment.clients && (
            <Link
              href={`/prontuarios/${appointment.clients.id}`}
              className="min-w-0 flex-1 truncate font-medium hover:underline"
            >
              {appointment.clients.full_name}
            </Link>
          )}
          <span className="flex shrink-0 items-center">
            <AppointmentInfoDialog
              appointment={appointment}
              canManage={canManage}
              trigger={
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-4 w-4 p-0"
                  aria-label="Ver informações"
                >
                  <Info className="size-3" />
                </Button>
              }
            />
          {canManage && isFuture && (
            <AppointmentFormDialog
              clients={[]}
              staff={staff}
              config={config}
              activeClinicId={clinicId}
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
                  className="h-4 w-4 p-0"
                  aria-label="Editar agendamento"
                >
                  <Pencil className="size-3" />
                </Button>
              }
            />
          )}
          </span>
        </div>
        {!compact && (
          <>
            {appointment.clients && (
              <Link
                href={`/prontuarios/${appointment.clients.id}`}
                className="block truncate font-medium hover:underline"
              >
                {appointment.clients.full_name}
              </Link>
            )}
            <p className="truncate text-[10px] text-muted-foreground">
              {APPOINTMENT_TYPE_LABELS[appointment.type]}
            </p>
            {height >= 54 && appointment.provider && (
              <p className="flex items-center gap-1 truncate text-[10px] text-muted-foreground">
                <UserRound className="size-3 shrink-0" />
                {appointment.provider.full_name}
              </p>
            )}
            {height >= 54 && (
              <JointBadge names={appointment.participantNames} />
            )}
            <div className="mt-0.5 flex items-center justify-between gap-1">
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                <span className={cn("size-2 rounded-full", ds.dot)} />
                {ds.label}
              </span>
              {canManage && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={isPending}
                        className="h-4 px-1 text-[10px]"
                      >
                        •••
                      </Button>
                    }
                  />
                  <DropdownMenuContent align="end" className="w-40">
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>Status</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {APPOINTMENT_STATUSES.filter(
                        (st) => st !== appointment.status
                      ).map((st) => (
                        <DropdownMenuItem
                          key={st}
                          onClick={() => setStatus(appointment, st)}
                        >
                          <span
                            className={cn(
                              "mr-1.5 size-2 rounded-full",
                              STATUS_DOT[st]
                            )}
                          />
                          {APPOINTMENT_STATUS_LABELS[st]}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">
        {day.toLocaleDateString("pt-BR", {
          weekday: "long",
          day: "2-digit",
          month: "long",
        })}
      </p>

      {holidayName && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-sm">
          <span className="font-medium text-amber-800">🎌 Feriado: {holidayName}</span>
          {holidayDecision === true && (
            <span className="text-emerald-700">· Haverá atendimento</span>
          )}
          {holidayDecision === false && (
            <span className="text-red-700">· Sem atendimento</span>
          )}
          {holidayDecision === null && (
            <span className="text-amber-700">· Aguardando confirmação</span>
          )}
          {canDecideHoliday && clinicId && (
            <span className="ml-auto flex gap-1.5">
              <Button
                size="sm"
                variant={holidayDecision === true ? "default" : "outline"}
                disabled={isPending}
                onClick={() => decideHolidayDay(true)}
              >
                Haverá atendimento
              </Button>
              <Button
                size="sm"
                variant={holidayDecision === false ? "default" : "outline"}
                disabled={isPending}
                onClick={() => decideHolidayDay(false)}
              >
                Sem atendimento
              </Button>
            </span>
          )}
        </div>
      )}

      {!dayOpen && !holidayName && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-sm text-amber-800">
          A unidade não atende neste dia. Para abrir, use “Configurar agenda →
          Liberar dia avulso”.
        </div>
      )}

      {isSpecialOpenDay && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-2.5 text-sm text-emerald-800">
          Dia avulso liberado para atendimento.
        </div>
      )}

      {planBlockLabel && (
        <div className="rounded-lg border border-violet-300 bg-violet-50 p-2.5 text-sm text-violet-800">
          Período de {planBlockLabel} (planejamento anual) — agenda fechada. Para
          atender, libere um dia avulso em “Configurar agenda”.
        </div>
      )}

      {closures.length > 0 && (
        <div className="space-y-1.5 rounded-lg border border-red-200 bg-red-50/60 p-2.5">
          <p className="flex items-center gap-1 text-xs font-semibold text-red-700">
            <Lock className="size-3.5" />
            Agenda fechada neste dia
          </p>
          <ul className="space-y-1">
            {closures.map((c) => {
              const detail =
                c.scope === "unit"
                  ? CLOSURE_SCOPE_LABELS.unit
                  : c.scope === "rooms"
                    ? `Salas: ${c.roomIds
                        .map((id) => roomNameById.get(id) ?? "—")
                        .join(", ")}`
                    : `Profissionais: ${c.providerIds
                        .map((id) => staffNameById.get(id) ?? "—")
                        .join(", ")}`;
              return (
                <li
                  key={c.id}
                  className="flex items-start justify-between gap-2 text-xs text-red-800"
                >
                  <span>
                    <span className="font-medium">
                      {CLOSURE_REASON_LABELS[c.reason]}
                    </span>{" "}
                    · {closureTimeLabel(c)} · {detail}
                    {c.note ? ` · ${c.note}` : ""}
                  </span>
                  {canManageClosures && clinicId && (
                    <ClosureControls
                      closure={c}
                      clinicId={clinicId}
                      rooms={(config?.rooms ?? []).map((r) => ({
                        id: r.id,
                        name: r.name,
                      }))}
                      staff={staff}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="overflow-x-auto pb-4">
        <div
          className="grid"
          style={{
            gridTemplateColumns: `${AXIS_W}px repeat(${columns.length}, minmax(${COL_MIN_W}px, 1fr))`,
            gridTemplateRows: `auto ${totalPx + TOP_PAD_PX}px`,
            minWidth: AXIS_W + columns.length * COL_MIN_W,
          }}
        >
          {/* Header row */}
          <div className="sticky top-0 z-10 border-b bg-background" />
          {columns.map((c) => (
            <div
              key={c.key}
              className={cn(
                "sticky top-0 z-10 truncate border-b border-l bg-background px-2 py-1.5 text-center text-xs font-medium",
                c.isOnline && "text-sky-700",
                c.isNoRoom && "text-muted-foreground"
              )}
            >
              <span className="inline-flex items-center gap-1">
                {c.isOnline && <Wifi className="size-3" />}
                {c.label}
              </span>
            </div>
          ))}

          {/* Time ruler */}
          <div className="relative" style={{ height: totalPx + TOP_PAD_PX }}>
            {hourLines.map((h) => (
              <div
                key={h}
                className="absolute right-1 -translate-y-1/2 text-[10px] tabular-nums text-muted-foreground"
                style={{ top: TOP_PAD_PX + (h - winStart) * PX_PER_MIN }}
              >
                {minutesToHHMM(h)}
              </div>
            ))}
          </div>

          {/* Room columns */}
          {columns.map((c) => {
            const colAppts = appointments.filter(
              (a) => columnKeyFor(a) === c.key
            );
            const { laneOf, laneCount } = assignLanes(colAppts);
            const isRoomColumn = !c.isOnline && !c.isNoRoom;
            const clickable = canQuickCreate && isRoomColumn;
            const droppable = canManage && isRoomColumn;
            const isDropTarget = droppable && dragAppt !== null;
            return (
              <div
                key={c.key}
                className={cn(
                  "relative border-l",
                  clickable && "cursor-pointer",
                  isDropTarget && "bg-primary/5 ring-1 ring-inset ring-primary/40"
                )}
                style={{
                  height: totalPx + TOP_PAD_PX,
                  backgroundPositionY: `${TOP_PAD_PX}px`,
                  ...columnBg,
                }}
                onClick={
                  clickable
                    ? (e) => {
                        if (planBlockLabel) {
                          toast.warning(
                            `Agenda fechada (${planBlockLabel} — planejamento anual). Libere um dia avulso para atender.`
                          );
                          return;
                        }
                        const time = slotTimeFromEvent(e);
                        // H2.10: dia/horário passado não abre o pop-up — só avisa.
                        if (
                          new Date(`${dayIso}T${time}:00`).getTime() < Date.now()
                        ) {
                          toast.warning(
                            "Não é possível criar agendamento no passado."
                          );
                          return;
                        }
                        const blocking = blockingClosureAt(c.key, time);
                        if (blocking) {
                          toast.warning(
                            `Agenda fechada (${CLOSURE_REASON_LABELS[blocking.reason]}) até ${new Date(
                              blocking.endsAt
                            ).toLocaleString("pt-BR", {
                              day: "2-digit",
                              month: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}.`
                          );
                          return;
                        }
                        setQuick({ date: dayIso, time, roomId: c.key });
                      }
                    : undefined
                }
                onDragOver={
                  droppable
                    ? (e) => {
                        if (!dragAppt) return;
                        e.preventDefault();
                        const t = slotTimeFromEvent(e);
                        if (dragOver?.col !== c.key || dragOver?.time !== t) {
                          setDragOver({ col: c.key, time: t });
                        }
                      }
                    : undefined
                }
                onDrop={
                  droppable
                    ? (e) => {
                        e.preventDefault();
                        if (dragAppt) {
                          reschedule(dragAppt, c.key, slotTimeFromEvent(e));
                          setDragAppt(null);
                          setDragOver(null);
                        }
                      }
                    : undefined
                }
              >
                {dragOver?.col === c.key && (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-10 flex items-center"
                    style={{
                      top:
                        TOP_PAD_PX +
                        (timeToMin(dragOver.time) - winStart) * PX_PER_MIN,
                    }}
                  >
                    <div className="h-0.5 w-full bg-primary" />
                    <span className="absolute -top-2 left-1 rounded bg-primary px-1 text-[10px] font-medium text-primary-foreground">
                      {dragOver.time}
                    </span>
                  </div>
                )}
                {isRoomColumn && renderOutsideBands()}
                {isRoomColumn && renderLunchBand()}
                {isRoomColumn &&
                  closuresForColumn(c.key).map((cl) =>
                    renderClosureOverlay(cl)
                  )}
                {colAppts.map((a) =>
                  renderAppointment(a, laneOf.get(a.id) ?? 0, laneCount)
                )}
              </div>
            );
          })}
        </div>
      </div>

      {canManage && (
        <p className="text-xs text-muted-foreground">
          Dica: clique num espaço vazio de uma sala para agendar rapidamente; ou
          arraste um card futuro para remarcá-lo em outro horário/sala.
        </p>
      )}

      {quick && (
        <AppointmentFormDialog
          key={`${quick.date}-${quick.time}-${quick.roomId}`}
          clients={clients ?? []}
          staff={staff}
          config={config}
          activeClinicId={clinicId}
          open
          onOpenChange={(o) => {
            if (!o) setQuick(null);
          }}
          initialDate={quick.date}
          initialTime={quick.time}
          initialRoomId={quick.roomId}
        />
      )}
    </div>
  );
}

function timeToMin(t: string): number {
  const [h, m] = (t ?? "").slice(0, 5).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
