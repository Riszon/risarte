import { createClient } from "@/lib/supabase/server";
import { toIsoDate } from "@/lib/agenda-view";
import {
  resolveAgendaSettings,
  timeToMinutes,
  type AgendaSettingRow,
} from "@/lib/agenda-settings";
import {
  CLOSURE_REASON_LABELS,
  mapClosure,
  type AgendaClosureRow,
} from "@/lib/closures";
import {
  mapPlanItem,
  PLAN_ITEM_LABELS,
  type PlanItemRow,
} from "@/lib/annual-plan";
import { holidayOn } from "@/lib/holidays";
import { DayStripView, type StripDay } from "./day-strip-view";

// AJ10: faixa longa — 1 mês de passado (histórico) e ~1 ano à frente; rolável.
const PAST_DAYS = 30;
const FUTURE_DAYS = 365;
const TOTAL_DAYS = PAST_DAYS + FUTURE_DAYS;
// "Tem horário livre?" só é calculado perto (agendar é o que importa no curto
// prazo) — passado e futuro distante mostram só a contagem.
const FREE_HORIZON_DAYS = 45;

function minutesToHHMM(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * H3.3/AJ10 — Faixa de dias da agenda: régua rolável (passado + ~1 ano) com a
 * disponibilidade da unidade, contagem de agendamentos e o motivo quando a
 * agenda está fechada (fechamento total = "Fechado (motivo)"; fechamento
 * parcial = alerta de atenção). Clicar num dia abre a visão Dia daquela data.
 */
export async function DayStrip({
  clinicId,
  selectedIso,
  salas,
}: {
  clinicId: string;
  selectedIso: string | null;
  salas?: string;
}) {
  const winStart = new Date();
  winStart.setHours(0, 0, 0, 0);
  winStart.setDate(winStart.getDate() - PAST_DAYS);
  const winEnd = new Date(winStart);
  winEnd.setDate(winEnd.getDate() + TOTAL_DAYS);
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
      .eq("is_active", true)
      .is("deleted_at", null),
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
        "id, clinic_id, type, locked, starts_date, ends_date, title, note, agenda_plan_item_people ( user_id )"
      )
      .or(`clinic_id.eq.${clinicId},clinic_id.is.null`)
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
  const todayIso = toIsoDate(new Date());

  const days: StripDay[] = [];
  for (let d = 0; d < TOTAL_DAYS; d++) {
    const day = new Date(winStart);
    day.setDate(day.getDate() + d);
    const iso = toIsoDate(day);
    const offsetFromToday = d - PAST_DAYS;
    const isPast = iso < todayIso;

    const holiday = holidayOn(iso);
    const hd = holidayDecision.get(iso);
    const special = openDayHours.get(iso);
    const isWeekdayOpen = cfg.weekdays.includes(day.getDay());
    // H4.8: campanha (informativa) nunca bloqueia; item da REDE travado bloqueia
    // mesmo com dia avulso.
    const blocks = (i: (typeof planItems)[number]) =>
      i.type !== "individual_vacation" &&
      i.type !== "campaign" &&
      i.startsDate <= iso &&
      i.endsDate >= iso;
    const unitBlock = planItems.find(blocks);
    const lockedNetBlock = planItems.find(
      (i) => blocks(i) && i.isNetwork && i.locked
    );

    let state: StripDay["state"] = "normal";
    let note: string | null = null;
    if (hd === false) {
      state = "holiday_closed";
      note = holiday?.name ?? "Feriado sem atendimento";
    } else if (lockedNetBlock) {
      state = "plan_block";
      note = lockedNetBlock.title || PLAN_ITEM_LABELS[lockedNetBlock.type];
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

    // AJ7: dia avulso num dia NORMAL estende (une); em dia fechado usa a própria.
    const normalOpenMin = timeToMinutes(cfg.openTime);
    const normalCloseMin = timeToMinutes(cfg.closeTime);
    const isNormalDay = isWeekdayOpen || hd === true;
    let openMin = normalOpenMin;
    let closeMin = normalCloseMin;
    if (special) {
      openMin = isNormalDay ? Math.min(normalOpenMin, special.open) : special.open;
      closeMin = isNormalDay ? Math.max(normalCloseMin, special.close) : special.close;
    }

    // AJ10: fechamentos do dia — total da unidade (mostra o MOTIVO, não "lotado")
    // x parcial (sala/profissional/período → alerta de atenção).
    const dayStartMs = new Date(`${iso}T00:00:00`).getTime();
    const dayOpenMs = new Date(`${iso}T${minutesToHHMM(openMin)}:00`).getTime();
    const dayCloseMs = new Date(`${iso}T${minutesToHHMM(closeMin)}:00`).getTime();
    const dayClosures = closures.filter(
      (c) =>
        new Date(c.startsAt).getTime() < dayCloseMs &&
        new Date(c.endsAt).getTime() > dayStartMs
    );
    const fullUnit = dayClosures.find(
      (c) =>
        c.scope === "unit" &&
        new Date(c.startsAt).getTime() <= dayOpenMs &&
        new Date(c.endsAt).getTime() >= dayCloseMs
    );
    const closedReason =
      dayOpen && fullUnit ? CLOSURE_REASON_LABELS[fullUnit.reason] : null;
    const attention = dayOpen && !closedReason && dayClosures.length > 0;

    // Disponibilidade: existe algum horário com alguma sala livre? Só perto.
    let hasFree: boolean | null = null;
    const nearHorizon =
      offsetFromToday >= 0 && offsetFromToday <= FREE_HORIZON_DAYS;
    if (dayOpen && !closedReason && nearHorizon && roomIds.length > 0) {
      hasFree = false;
      for (let m = openMin; m + 15 <= closeMin && !hasFree; m += 15) {
        if (cfg.lunchEnabled && m < lunchEnd && m + 15 > lunchStart) continue;
        const startMs = new Date(`${iso}T${minutesToHHMM(m)}:00`).getTime();
        const endMs = startMs + 15 * 60_000;
        if (startMs < nowMs) continue;

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

    days.push({ iso, state, note, count, hasFree, closedReason, attention, isPast });
  }

  return (
    <DayStripView
      days={days}
      selectedIso={selectedIso}
      todayIso={todayIso}
      salas={salas}
    />
  );
}
