"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Info, Lock, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  APPOINTMENT_TYPE_LABELS,
  type StaffOption,
} from "@/lib/appointments";
import { CLOSURE_REASON_LABELS, type AgendaClosure } from "@/lib/closures";
import { type AgendaFormConfig } from "./actions";
import { AppointmentFormDialog } from "./appointment-form-dialog";
import { AppointmentInfoDialog } from "./appointment-info-dialog";
import {
  STATUS_STYLES,
  displayedStatus,
  type AgendaAppointment,
} from "./week-grid";

const SLOT_MIN = 15;
const SLOT_PX = 16;
const PX_PER_MIN = SLOT_PX / SLOT_MIN;
const AXIS_W = 52;
const COL_MIN_W = 132;
// AJ9: respiro no topo para o primeiro horário não colar na linha do cabeçalho.
const TOP_PAD_PX = 12;
const WEEKDAY_LABELS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

function localMinutes(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}
function minutesToHHMM(m: number): string {
  const mm = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(mm / 60)).padStart(2, "0")}:${String(mm % 60).padStart(2, "0")}`;
}
function timeToMin(t: string): number {
  const [h, m] = (t ?? "").slice(0, 5).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

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
 * Week view as a time grid (GR2): days as columns with a vertical hour ruler
 * (hour labels + 15-min ticks). Only configured working days are shown (plus
 * special open days, holiday-open days and any day with bookings).
 */
export function WeekTimeGrid({
  weekStartIso,
  appointments,
  canManage,
  staff,
  config,
  clients,
  activeClinicId,
  weekdays,
  openDayDates = [],
  holidayClosedDates = [],
  holidayOpenDates = [],
  holidays = [],
  closures = [],
}: {
  weekStartIso: string;
  appointments: AgendaAppointment[];
  canManage: boolean;
  staff: StaffOption[];
  config?: AgendaFormConfig;
  clients?: { id: string; full_name: string; inactive?: boolean }[];
  activeClinicId?: string;
  weekdays?: number[];
  openDayDates?: string[];
  holidayClosedDates?: string[];
  holidayOpenDates?: string[];
  holidays?: { date: string; name: string }[];
  closures?: AgendaClosure[];
}) {
  const today = new Date();
  const weekStart = new Date(weekStartIso);

  const [quick, setQuick] = useState<{ date: string; time: string } | null>(null);
  const canQuickCreate = canManage && Boolean(clients);

  const openDaySet = new Set(openDayDates);
  const holidayClosedSet = new Set(holidayClosedDates);
  const holidayOpenSet = new Set(holidayOpenDates);
  const holidayNameByDate = new Map(holidays.map((h) => [h.date, h.name]));

  function closuresOnDay(iso: string): AgendaClosure[] {
    const ds = new Date(`${iso}T00:00:00`).getTime();
    const de = ds + 86_400_000;
    return closures.filter(
      (c) =>
        new Date(c.startsAt).getTime() < de && new Date(c.endsAt).getTime() > ds
    );
  }

  const hasAppts = (date: Date) =>
    appointments.some(
      (a) => new Date(a.starts_at).toDateString() === date.toDateString()
    );

  const allDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });
  const days = weekdays
    ? allDays.filter((date) => {
        const iso = isoOf(date);
        if (holidayClosedSet.has(iso)) return hasAppts(date);
        if (weekdays.includes(date.getDay())) return true;
        if (openDaySet.has(iso) || holidayOpenSet.has(iso)) return true;
        return hasAppts(date);
      })
    : allDays;

  // Time window: configured hours expanded to fit appointments.
  let winStart = config ? timeToMin(config.openTime) : 8 * 60;
  let winEnd = config ? timeToMin(config.closeTime) : 18 * 60;
  for (const a of appointments) {
    if (!days.some((d) => d.toDateString() === new Date(a.starts_at).toDateString()))
      continue;
    const s = localMinutes(a.starts_at);
    let e = localMinutes(a.ends_at);
    if (e <= s) e = 24 * 60;
    winStart = Math.min(winStart, s);
    winEnd = Math.max(winEnd, e);
  }
  winStart = Math.floor(winStart / 60) * 60;
  winEnd = Math.ceil(winEnd / 60) * 60;
  if (winEnd <= winStart) winEnd = winStart + 60;
  const totalPx = (winEnd - winStart) * PX_PER_MIN;

  const hourLines: number[] = [];
  for (let h = winStart; h <= winEnd; h += 60) hourLines.push(h);

  const columnBg = {
    backgroundImage: `repeating-linear-gradient(to bottom, rgba(0,0,0,0.05) 0, rgba(0,0,0,0.05) 1px, transparent 1px, transparent ${SLOT_PX}px), repeating-linear-gradient(to bottom, rgba(0,0,0,0.14) 0, rgba(0,0,0,0.14) 1px, transparent 1px, transparent ${SLOT_PX * 4}px)`,
  };

  function renderCard(a: AgendaAppointment, lane: number, lanes: number) {
    const s = clamp(localMinutes(a.starts_at), winStart, winEnd);
    let endMin = localMinutes(a.ends_at);
    if (endMin <= localMinutes(a.starts_at)) endMin = 24 * 60;
    const e = clamp(endMin, winStart, winEnd);
    const top = TOP_PAD_PX + (s - winStart) * PX_PER_MIN;
    const height = Math.max(15, (e - s) * PX_PER_MIN);
    const w = 100 / lanes;
    const ds = displayedStatus(a);
    const isFuture = new Date(a.starts_at).getTime() >= today.getTime();
    // H2.8: agendamento curto (15 min) vira um card compacto de UMA linha,
    // com o nome do cliente visível (antes ficava uma faixa vazia).
    const compact = height < 40;
    return (
      <div
        key={a.id}
        onClick={(ev) => ev.stopPropagation()}
        className={cn(
          "absolute overflow-hidden rounded border px-1 shadow-sm",
          compact ? "flex items-center gap-1 text-[9px]" : "py-0.5 text-[10px]",
          STATUS_STYLES[a.status],
          a.needs_reschedule && "ring-2 ring-red-500"
        )}
        style={{
          top,
          height,
          left: `calc(${lane * w}% + 1px)`,
          width: `calc(${w}% - 2px)`,
        }}
      >
        <div
          className={cn(
            "flex items-center gap-0.5",
            compact ? "min-w-0 flex-1" : "justify-between"
          )}
        >
          <span className="shrink-0 font-medium">
            {new Date(a.starts_at).toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          {compact && a.clients && (
            <Link
              href={`/prontuarios/${a.clients.id}`}
              className="min-w-0 truncate font-medium hover:underline"
            >
              {a.clients.full_name}
            </Link>
          )}
          <span className="flex shrink-0 items-center">
            <AppointmentInfoDialog
              appointment={a}
              canManage={canManage}
              trigger={
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-3.5 w-3.5 p-0"
                  aria-label="Ver informações"
                >
                  <Info className="size-2.5" />
                </Button>
              }
            />
            {canManage && isFuture && (
              <AppointmentFormDialog
                clients={[]}
                staff={staff}
                config={config}
                activeClinicId={activeClinicId}
                appointment={{
                  id: a.id,
                  type: a.type,
                  starts_at: a.starts_at,
                  ends_at: a.ends_at,
                  provider_user_id: a.provider_user_id,
                  notes: a.notes,
                  room_id: a.room_id ?? null,
                  clientName: a.clients?.full_name ?? "",
                }}
                trigger={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-3.5 w-3.5 p-0"
                    aria-label="Editar"
                  >
                    <Pencil className="size-2.5" />
                  </Button>
                }
              />
            )}
          </span>
        </div>
        {!compact && (
          <>
            {a.clients && (
              <Link
                href={`/prontuarios/${a.clients.id}`}
                className="block truncate font-medium hover:underline"
              >
                {a.clients.full_name}
              </Link>
            )}
            <p className="truncate text-muted-foreground">
              {APPOINTMENT_TYPE_LABELS[a.type]}
            </p>
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <span className={cn("size-1.5 rounded-full", ds.dot)} />
              {ds.label}
            </span>
          </>
        )}
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
        className="pointer-events-none absolute inset-x-0 z-[1] border-y border-amber-200 bg-amber-100/50"
        style={{ top, height }}
      />
    );
  }

  // AJ8: marca em cinza tracejado os horários FORA do expediente normal (antes
  // da abertura e depois do fechamento), como o almoço é marcado em âmbar.
  function renderOutsideBands() {
    if (!config) return null;
    const openMin = timeToMin(config.openTime);
    const closeMin = timeToMin(config.closeTime);
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

  if (days.length === 0) {
    return (
      <p className="rounded-lg border bg-muted/40 p-6 text-center text-sm text-muted-foreground">
        Nenhum dia de atendimento neste período.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto pb-4">
      <div
        className="grid"
        style={{
          gridTemplateColumns: `${AXIS_W}px repeat(${days.length}, minmax(${COL_MIN_W}px, 1fr))`,
          gridTemplateRows: `auto ${totalPx + TOP_PAD_PX}px`,
          minWidth: AXIS_W + days.length * COL_MIN_W,
        }}
      >
        {/* Header row */}
        <div className="sticky top-0 z-10 border-b bg-background" />
        {days.map((date) => {
          const iso = isoOf(date);
          const isToday = date.toDateString() === today.toDateString();
          const holidayName = holidayNameByDate.get(iso);
          const holidayClosed = holidayClosedSet.has(iso);
          const isSpecialOpen = openDaySet.has(iso);
          return (
            <div
              key={iso}
              className={cn(
                "sticky top-0 z-10 border-b border-l bg-background px-1 py-1 text-center text-xs",
                isToday && "bg-primary/5"
              )}
            >
              {/* H2.7: clicar no dia abre a visão Dia (como já é no Mês). */}
              <Link
                href={`/agenda?vista=dia&ref=${iso}`}
                className="hover:underline"
                title="Abrir a visão do dia"
              >
                <span className="font-medium">
                  {WEEKDAY_LABELS[(date.getDay() + 6) % 7]}
                </span>{" "}
                <span className="text-muted-foreground">
                  {date.toLocaleDateString("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                  })}
                </span>
              </Link>
              {holidayName && (
                <span
                  className="block truncate text-[10px] text-red-700"
                  title={holidayName}
                >
                  🎌 {holidayName}
                  {holidayClosed ? " (fechado)" : ""}
                </span>
              )}
              {isSpecialOpen && !holidayName && (
                <span className="block text-[10px] text-emerald-700">
                  Dia avulso
                </span>
              )}
              {closuresOnDay(iso).length > 0 && (
                <span
                  className="flex items-center justify-center gap-0.5 text-[10px] text-red-700"
                  title="Há fechamento de agenda neste dia"
                >
                  <Lock className="size-2.5" />
                  fechamento
                </span>
              )}
            </div>
          );
        })}

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

        {/* Day columns */}
        {days.map((date) => {
          const iso = isoOf(date);
          const dayAppts = appointments.filter(
            (a) => new Date(a.starts_at).toDateString() === date.toDateString()
          );
          const { laneOf, laneCount } = assignLanes(dayAppts);
          return (
            <div
              key={iso}
              className={cn("relative border-l", canQuickCreate && "cursor-pointer")}
              style={{
                height: totalPx + TOP_PAD_PX,
                backgroundPositionY: `${TOP_PAD_PX}px`,
                ...columnBg,
              }}
              onClick={
                canQuickCreate
                  ? (e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const y = e.clientY - rect.top;
                      let m = winStart + (y - TOP_PAD_PX) / PX_PER_MIN;
                      m = Math.round(m / SLOT_MIN) * SLOT_MIN;
                      m = Math.max(winStart, Math.min(winEnd - SLOT_MIN, m));
                      const time = minutesToHHMM(m);
                      const startMs = new Date(`${iso}T${time}:00`).getTime();
                      const endMs = startMs + SLOT_MIN * 60_000;
                      // H2.10: dia/horário passado não abre o pop-up — só avisa.
                      if (startMs < Date.now()) {
                        toast.warning(
                          "Não é possível criar agendamento no passado."
                        );
                        return;
                      }
                      const blocking = closures.find(
                        (c) =>
                          c.scope === "unit" &&
                          new Date(c.startsAt).getTime() < endMs &&
                          new Date(c.endsAt).getTime() > startMs
                      );
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
                      setQuick({ date: iso, time });
                    }
                  : undefined
              }
            >
              {renderOutsideBands()}
              {renderLunchBand()}
              {dayAppts.map((a) =>
                renderCard(a, laneOf.get(a.id) ?? 0, laneCount)
              )}
            </div>
          );
        })}
      </div>

      {quick && (
        <AppointmentFormDialog
          key={`${quick.date}-${quick.time}`}
          clients={clients ?? []}
          staff={staff}
          config={config}
          activeClinicId={activeClinicId}
          open
          onOpenChange={(o) => {
            if (!o) setQuick(null);
          }}
          initialDate={quick.date}
          initialTime={quick.time}
        />
      )}
    </div>
  );
}
