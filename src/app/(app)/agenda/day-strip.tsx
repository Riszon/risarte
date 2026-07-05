import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { agendaHref, toIsoDate } from "@/lib/agenda-view";
import {
  resolveAgendaSettings,
  timeToMinutes,
  type AgendaSettingRow,
} from "@/lib/agenda-settings";
import { mapClosure, type AgendaClosureRow } from "@/lib/closures";
import {
  mapPlanItem,
  PLAN_ITEM_LABELS,
  type PlanItemRow,
} from "@/lib/annual-plan";
import { holidayOn } from "@/lib/holidays";

const DAYS_AHEAD = 42; // 6 semanas de "rodinha" a partir de hoje.

const WEEKDAY_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

type StripState =
  | "normal"
  | "closed"
  | "holiday_closed"
  | "holiday_pending"
  | "holiday_open"
  | "open_day"
  | "plan_block";

type StripDay = {
  iso: string;
  state: StripState;
  note: string | null;
  count: number;
  /** null = dia sem atendimento (sem indicador de vaga). */
  hasFree: boolean | null;
};

function minutesToHHMM(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * H3.3 — Seletor de dias da agenda: régua rolável com os próximos dias, cada
 * um mostrando se a UNIDADE tem horário livre (alguma sala vaga), quantos
 * agendamentos já tem, e feriados/fechamentos/dias avulsos evidentes. Clicar
 * num dia abre a visão Dia daquela data.
 */
export async function DayStrip({
  clinicId,
  selectedIso,
  salas,
}: {
  clinicId: string;
  /** Dia atualmente aberto (visão Dia) — ganha o destaque de selecionado. */
  selectedIso: string | null;
  /** Filtro de salas (?salas=) preservado nos links. */
  salas?: string;
}) {
  const winStart = new Date();
  winStart.setHours(0, 0, 0, 0);
  const winEnd = new Date(winStart);
  winEnd.setDate(winEnd.getDate() + DAYS_AHEAD);
  const startIso = winStart.toISOString();
  const endIso = winEnd.toISOString();

  const supabase = await createClient();
  const [
    { data: settingRows },
    { data: roomRows },
    { data: apptRows },
    { data: closureRows },
    { data: openDayRows },
    { data: holidayRows },
    { data: planRows },
  ] = await Promise.all([
    supabase
      .from("clinic_agenda_settings")
      .select(
        "clinic_id, open_time, close_time, weekdays, chairs, lunch_enabled, lunch_start, lunch_end"
      )
      .returns<AgendaSettingRow[]>(),
    supabase
      .from("clinic_rooms")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("is_active", true),
    supabase
      .from("appointments")
      .select("room_id, is_online, starts_at, ends_at, status")
      .eq("clinic_id", clinicId)
      .gte("starts_at", startIso)
      .lt("starts_at", endIso),
    supabase
      .from("agenda_closures")
      .select(
        "id, starts_at, ends_at, scope, reason, note, agenda_closure_rooms ( room_id ), agenda_closure_providers ( user_id )"
      )
      .eq("clinic_id", clinicId)
      .lt("starts_at", endIso)
      .gt("ends_at", startIso),
    supabase
      .from("agenda_open_days")
      .select("date, start_time, end_time")
      .eq("clinic_id", clinicId)
      .gte("date", toIsoDate(winStart))
      .lt("date", toIsoDate(winEnd)),
    supabase
      .from("clinic_holiday_decisions")
      .select("holiday_date, will_attend")
      .eq("clinic_id", clinicId)
      .gte("holiday_date", toIsoDate(winStart))
      .lt("holiday_date", toIsoDate(winEnd)),
    supabase
      .from("agenda_plan_items")
      .select(
        "id, type, starts_date, ends_date, title, note, agenda_plan_item_people ( user_id )"
      )
      .eq("clinic_id", clinicId)
      .lte("starts_date", toIsoDate(winEnd))
      .gte("ends_date", toIsoDate(winStart)),
  ]);

  const cfg = resolveAgendaSettings(settingRows ?? [], clinicId);
  const roomIds = (roomRows ?? []).map((r) => r.id as string);
  const closures = (closureRows ?? []).map((r) =>
    mapClosure(r as AgendaClosureRow)
  );
  const openDayHours = new Map<
    string,
    { open: number; close: number; label: string }
  >();
  for (const r of (openDayRows ?? []) as {
    date: string;
    start_time: string;
    end_time: string;
  }[]) {
    const start = r.start_time.slice(0, 5);
    const end = r.end_time.slice(0, 5);
    openDayHours.set(r.date, {
      open: timeToMinutes(start),
      close: timeToMinutes(end),
      label: `Dia avulso ${start}–${end}`,
    });
  }
  const holidayDecision = new Map<string, boolean>();
  for (const r of (holidayRows ?? []) as {
    holiday_date: string;
    will_attend: boolean;
  }[]) {
    holidayDecision.set(r.holiday_date, r.will_attend);
  }
  const planItems = (planRows ?? []).map((r) => mapPlanItem(r as PlanItemRow));
  const appts = (apptRows ?? []).filter(
    (a) => a.status !== "cancelled" && a.status !== "no_show"
  );

  const lunchStart = cfg.lunchEnabled ? timeToMinutes(cfg.lunchStart) : -1;
  const lunchEnd = cfg.lunchEnabled ? timeToMinutes(cfg.lunchEnd) : -1;
  const nowMs = new Date().getTime();

  const days: StripDay[] = [];
  for (let d = 0; d < DAYS_AHEAD; d++) {
    const day = new Date(winStart);
    day.setDate(day.getDate() + d);
    const iso = toIsoDate(day);

    const holiday = holidayOn(iso);
    const hd = holidayDecision.get(iso);
    const special = openDayHours.get(iso);
    const isWeekdayOpen = cfg.weekdays.includes(day.getDay());
    const unitBlock = planItems.find(
      (i) =>
        i.type !== "individual_vacation" &&
        i.startsDate <= iso &&
        i.endsDate >= iso
    );

    let state: StripState = "normal";
    let note: string | null = null;
    if (hd === false) {
      state = "holiday_closed";
      note = holiday?.name ?? "Feriado sem atendimento";
    } else if (unitBlock && !special) {
      state = "plan_block";
      note = unitBlock.title || PLAN_ITEM_LABELS[unitBlock.type];
    } else if (special) {
      state = "open_day";
      note = special.label;
    } else if (!isWeekdayOpen && hd !== true) {
      state = "closed";
      note = "Não atende";
    } else if (holiday && hd === true) {
      state = "holiday_open";
      note = `${holiday.name} (atende)`;
    } else if (holiday && hd === undefined) {
      state = "holiday_pending";
      note = `${holiday.name} — a confirmar`;
    }

    const count = appts.filter(
      (a) => toIsoDate(new Date(a.starts_at)) === iso
    ).length;

    const dayOpen =
      state === "normal" ||
      state === "open_day" ||
      state === "holiday_open" ||
      state === "holiday_pending";

    // Disponibilidade da UNIDADE: existe algum horário em que alguma sala
    // ativa esteja livre (fora do almoço/fechamentos)?
    let hasFree: boolean | null = null;
    if (dayOpen && roomIds.length > 0) {
      hasFree = false;
      const openMin =
        special && !isWeekdayOpen ? special.open : timeToMinutes(cfg.openTime);
      const closeMin =
        special && !isWeekdayOpen ? special.close : timeToMinutes(cfg.closeTime);
      for (let m = openMin; m + 15 <= closeMin && !hasFree; m += 15) {
        if (cfg.lunchEnabled && m < lunchEnd && m + 15 > lunchStart) continue;
        const startMs = new Date(`${iso}T${minutesToHHMM(m)}:00`).getTime();
        const endMs = startMs + 15 * 60_000;
        if (startMs < nowMs) continue;

        // Fechamentos: unidade toda bloqueia o slot; por sala bloqueia as listadas.
        const slotClosures = closures.filter((c) => {
          const cs = new Date(c.startsAt).getTime();
          const ce = new Date(c.endsAt).getTime();
          return startMs < ce && endMs > cs;
        });
        if (slotClosures.some((c) => c.scope === "unit")) continue;
        const closedRooms = new Set(
          slotClosures.filter((c) => c.scope === "rooms").flatMap((c) => c.roomIds)
        );

        const occupied = new Set(
          appts
            .filter(
              (a) =>
                !a.is_online &&
                a.room_id &&
                startMs < new Date(a.ends_at).getTime() &&
                endMs > new Date(a.starts_at).getTime()
            )
            .map((a) => a.room_id as string)
        );
        if (roomIds.some((r) => !occupied.has(r) && !closedRooms.has(r))) {
          hasFree = true;
        }
      }
    }

    days.push({ iso, state, note, count, hasFree });
  }

  const todayIso = toIsoDate(new Date());

  return (
    <div className="rounded-lg border bg-card p-2">
      <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]">
        {days.map((d) => {
          const date = new Date(`${d.iso}T00:00:00`);
          const blocked =
            d.state === "closed" ||
            d.state === "holiday_closed" ||
            d.state === "plan_block";
          const isSelected = d.iso === selectedIso;
          const showMonth =
            date.getDate() === 1 || d.iso === days[0].iso;
          const tooltip = [
            d.note,
            d.count > 0
              ? `${d.count} agendamento${d.count === 1 ? "" : "s"}`
              : null,
            d.hasFree === true
              ? "Tem horários livres"
              : d.hasFree === false
                ? "Sem horários livres"
                : null,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <Link
              key={d.iso}
              href={agendaHref("dia", d.iso, undefined, salas)}
              title={tooltip || undefined}
              className={cn(
                "flex min-w-12 shrink-0 flex-col items-center rounded-lg border px-1.5 py-1 text-center transition-colors",
                blocked
                  ? "bg-muted/60 text-muted-foreground"
                  : "hover:border-primary hover:bg-primary/5",
                d.state === "holiday_closed" || d.state === "plan_block"
                  ? "bg-red-50 text-red-700"
                  : d.state === "holiday_pending"
                    ? "bg-amber-50"
                    : d.state === "open_day"
                      ? "border-gold/60 bg-gold/10"
                      : "",
                isSelected && "border-primary ring-2 ring-primary/40",
                d.iso === todayIso && !isSelected && "border-primary/60"
              )}
            >
              <span className="text-[10px] uppercase leading-tight text-muted-foreground">
                {WEEKDAY_SHORT[date.getDay()]}
              </span>
              <span className="text-sm font-semibold leading-tight">
                {date.getDate()}
              </span>
              {showMonth && (
                <span className="text-[9px] capitalize leading-tight text-muted-foreground">
                  {date.toLocaleDateString("pt-BR", { month: "short" })}
                </span>
              )}
              {blocked ? (
                <span className="mt-0.5 text-[9px] font-medium leading-tight">
                  {d.state === "closed" ? "Fechado" : "Sem atend."}
                </span>
              ) : (
                <span className="mt-0.5 flex items-center gap-0.5 text-[9px] leading-tight">
                  {d.hasFree !== null && (
                    <span
                      className={cn(
                        "size-1.5 rounded-full",
                        d.hasFree ? "bg-emerald-500" : "bg-red-500"
                      )}
                    />
                  )}
                  {d.count > 0 && (
                    <span className="text-muted-foreground">{d.count}</span>
                  )}
                </span>
              )}
            </Link>
          );
        })}
      </div>
      <p className="mt-1 flex flex-wrap gap-x-3 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="size-1.5 rounded-full bg-emerald-500" /> tem horário
          livre
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="size-1.5 rounded-full bg-red-500" /> lotado
        </span>
        <span>número = agendamentos do dia · clique para abrir o dia</span>
      </p>
    </div>
  );
}
