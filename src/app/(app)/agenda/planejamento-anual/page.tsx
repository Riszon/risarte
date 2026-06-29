import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  resolveAgendaSettings,
  timeToMinutes,
  type AgendaSettingRow,
} from "@/lib/agenda-settings";
import { holidaysInRange } from "@/lib/holidays";
import {
  mapPlanItem,
  UNIT_BLOCKING_TYPES,
  PLAN_ITEM_LABELS,
  PLAN_ITEM_CLASS,
  PLAN_ITEM_TYPES,
  itemCoversDate,
  itemDayCount,
  type PlanItem,
  type PlanItemRow,
  type PlanItemType,
} from "@/lib/annual-plan";
import { AnnualPlanManager } from "./annual-plan-manager";

export const metadata: Metadata = { title: "Planejamento anual" };

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default async function AnnualPlanPage(
  props: PageProps<"/agenda/planejamento-anual">
) {
  const session = await getSessionContext();
  const clinic = session.activeClinic;
  if (!clinic || clinic.type === "franchisor") {
    return (
      <div className="mx-auto max-w-3xl space-y-3 px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Planejamento anual de atendimento
        </h1>
        <p className="text-sm text-muted-foreground">
          Selecione uma unidade no menu lateral.
        </p>
      </div>
    );
  }
  const canManage = hasRoleInClinic(session, clinic.id, ["unit_manager"]);
  if (!canManage) redirect("/agenda");

  const sp = await props.searchParams;
  const now = new Date();
  const year =
    typeof sp.ano === "string" && /^\d{4}$/.test(sp.ano)
      ? Number(sp.ano)
      : now.getFullYear();
  const jan1 = `${year}-01-01`;
  const dec31 = `${year}-12-31`;
  const todayIso = ymd(now);

  const supabase = await createClient();
  const [{ data: settingRows }, { data: planRows }, { data: staffRows }, { data: holidayRows }] =
    await Promise.all([
      supabase
        .from("clinic_agenda_settings")
        .select(
          "clinic_id, open_time, close_time, weekdays, chairs, lunch_enabled, lunch_start, lunch_end"
        )
        .returns<AgendaSettingRow[]>(),
      supabase
        .from("agenda_plan_items")
        .select(
          "id, type, starts_date, ends_date, title, note, agenda_plan_item_people ( user_id )"
        )
        .eq("clinic_id", clinic.id)
        .lte("starts_date", dec31)
        .gte("ends_date", jan1)
        .order("starts_date"),
      supabase
        .from("user_clinic_roles")
        .select("user_id, profiles ( full_name )")
        .eq("clinic_id", clinic.id),
      supabase
        .from("clinic_holiday_decisions")
        .select("holiday_date, will_attend")
        .eq("clinic_id", clinic.id)
        .gte("holiday_date", jan1)
        .lte("holiday_date", dec31),
    ]);

  const cfg = resolveAgendaSettings(settingRows ?? [], clinic.id);
  const items = (planRows ?? []).map((r) => mapPlanItem(r as PlanItemRow));

  const staffMap = new Map<string, string>();
  for (const r of (staffRows ?? []) as unknown as {
    user_id: string;
    profiles: { full_name: string } | null;
  }[]) {
    if (!staffMap.has(r.user_id)) {
      staffMap.set(r.user_id, r.profiles?.full_name ?? "—");
    }
  }
  const staff = [...staffMap.entries()]
    .map(([userId, name]) => ({ userId, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const holidayDecision = new Map<string, boolean>();
  for (const r of (holidayRows ?? []) as {
    holiday_date: string;
    will_attend: boolean;
  }[]) {
    holidayDecision.set(r.holiday_date, r.will_attend);
  }
  const yearHolidays = holidaysInRange(jan1, dec31);

  // -------------------------------------------------------------------------
  // Report: working days + estimated attendance hours.
  // -------------------------------------------------------------------------
  const unitBlocking = items.filter((i) => UNIT_BLOCKING_TYPES.includes(i.type));
  const dayBlocked = (iso: string) =>
    unitBlocking.some((i) => itemCoversDate(i, iso));

  let workingDays = 0;
  const cursor = new Date(`${jan1}T00:00:00`);
  const end = new Date(`${dec31}T00:00:00`);
  while (cursor.getTime() <= end.getTime()) {
    const iso = ymd(cursor);
    const wd = cursor.getDay();
    const hd = holidayDecision.get(iso);
    const open =
      hd === false
        ? false
        : cfg.weekdays.includes(wd) || hd === true;
    if (open && !dayBlocked(iso)) workingDays += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  const dailyMinutes = Math.max(
    0,
    timeToMinutes(cfg.closeTime) -
      timeToMinutes(cfg.openTime) -
      (cfg.lunchEnabled
        ? timeToMinutes(cfg.lunchEnd) - timeToMinutes(cfg.lunchStart)
        : 0)
  );
  const attendanceHours = Math.round((workingDays * dailyMinutes) / 60);

  const countByType: Record<PlanItemType, { items: number; days: number }> =
    Object.fromEntries(
      PLAN_ITEM_TYPES.map((t) => [t, { items: 0, days: 0 }])
    ) as Record<PlanItemType, { items: number; days: number }>;
  for (const i of items) {
    countByType[i.type].items += 1;
    countByType[i.type].days += itemDayCount(i);
  }
  const holidaysWorked = yearHolidays.filter(
    (h) => holidayDecision.get(h.date) === true
  ).length;
  const holidaysClosed = yearHolidays.filter(
    (h) => holidayDecision.get(h.date) === false
  ).length;
  const holidaysPending = yearHolidays.length - holidaysWorked - holidaysClosed;

  // 12-month overview: which items touch each month.
  const months = Array.from({ length: 12 }, (_, m) => {
    const mStart = `${year}-${String(m + 1).padStart(2, "0")}-01`;
    const mEnd = ymd(new Date(year, m + 1, 0));
    const monthItems = items.filter(
      (i) => i.startsDate <= mEnd && i.endsDate >= mStart
    );
    const monthHolidays = yearHolidays.filter(
      (h) => h.date >= mStart && h.date <= mEnd
    ).length;
    return {
      label: new Date(year, m, 1).toLocaleDateString("pt-BR", {
        month: "short",
      }),
      items: monthItems,
      holidays: monthHolidays,
    };
  });

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Planejamento anual de atendimento
          </h1>
          <p className="text-sm text-muted-foreground">
            {clinic.name} — recessos, férias, eventos, treinamentos e
            manutenções programadas.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href={`/agenda/planejamento-anual?ano=${year - 1}`} />}
          >
            ← {year - 1}
          </Button>
          <span className="px-2 text-lg font-semibold">{year}</span>
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href={`/agenda/planejamento-anual?ano=${year + 1}`} />}
          >
            {year + 1} →
          </Button>
        </div>
      </div>

      {/* Relatório-resumo --------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Resumo do ano {year}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border p-2">
              <p className="text-2xl font-semibold">{workingDays}</p>
              <p className="text-xs text-muted-foreground">dias trabalháveis</p>
            </div>
            <div className="rounded-lg border p-2">
              <p className="text-2xl font-semibold">{attendanceHours}h</p>
              <p className="text-xs text-muted-foreground">
                horas de atendimento (estimativa)
              </p>
            </div>
            <div className="rounded-lg border p-2">
              <p className="text-2xl font-semibold">{yearHolidays.length}</p>
              <p className="text-xs text-muted-foreground">
                feriados ({holidaysWorked} trabalha · {holidaysClosed} fecha ·{" "}
                {holidaysPending} a decidir)
              </p>
            </div>
            <div className="rounded-lg border p-2">
              <p className="text-2xl font-semibold">{items.length}</p>
              <p className="text-xs text-muted-foreground">itens planejados</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {PLAN_ITEM_TYPES.map((t) =>
              countByType[t].items > 0 ? (
                <span
                  key={t}
                  className={`rounded-full px-2.5 py-0.5 text-xs ${PLAN_ITEM_CLASS[t]}`}
                >
                  {PLAN_ITEM_LABELS[t]}: {countByType[t].items} ({countByType[t].days}{" "}
                  dia{countByType[t].days === 1 ? "" : "s"})
                </span>
              ) : null
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Estimativa baseada nos dias e horários configurados (desconta almoço,
            feriados fechados e períodos planejados). Dias avulsos liberados não
            entram nesta conta automática.
          </p>
        </CardContent>
      </Card>

      {/* Visão dos 12 meses ------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Visão dos 12 meses</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {months.map((m, i) => (
              <div key={i} className="rounded-lg border p-2">
                <p className="text-xs font-semibold capitalize">
                  {m.label.replace(".", "")}
                  {m.holidays > 0 && (
                    <span className="ml-1 font-normal text-red-700">
                      · {m.holidays} feriado{m.holidays === 1 ? "" : "s"}
                    </span>
                  )}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {m.items.length === 0 ? (
                    <span className="text-[10px] text-muted-foreground">—</span>
                  ) : (
                    m.items.map((it) => (
                      <span
                        key={it.id}
                        className={`rounded px-1 text-[10px] ${PLAN_ITEM_CLASS[it.type]}`}
                        title={it.title ?? PLAN_ITEM_LABELS[it.type]}
                      >
                        {PLAN_ITEM_LABELS[it.type]}
                      </span>
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <AnnualPlanManager
        clinicId={clinic.id}
        year={year}
        todayIso={todayIso}
        items={items.map((i: PlanItem) => ({
          id: i.id,
          type: i.type,
          startsDate: i.startsDate,
          endsDate: i.endsDate,
          title: i.title,
          note: i.note,
          userIds: i.userIds,
          isPast: i.endsDate < todayIso,
        }))}
        staff={staff}
        holidays={yearHolidays.map((h) => ({
          date: h.date,
          name: h.name,
          decision: holidayDecision.has(h.date)
            ? (holidayDecision.get(h.date) as boolean)
            : null,
        }))}
      />
    </div>
  );
}
