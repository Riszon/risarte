// Annual attendance plan (GR6): recess, vacations (collective/individual),
// events, trainings and scheduled maintenance. Unit-blocking types close the
// whole unit on those dates; individual vacation closes only the listed people.

export const PLAN_ITEM_TYPES = [
  "recess",
  "collective_vacation",
  "individual_vacation",
  "event",
  "training",
  "maintenance",
] as const;
export type PlanItemType = (typeof PLAN_ITEM_TYPES)[number];

export const PLAN_ITEM_LABELS: Record<PlanItemType, string> = {
  recess: "Recesso",
  collective_vacation: "Férias coletivas",
  individual_vacation: "Férias individuais",
  event: "Evento",
  training: "Treinamento",
  maintenance: "Manutenção",
};

/** Types that close the whole unit (overridden only by a special open day). */
export const UNIT_BLOCKING_TYPES: PlanItemType[] = [
  "recess",
  "collective_vacation",
  "event",
  "training",
  "maintenance",
];

export const PLAN_ITEM_CLASS: Record<PlanItemType, string> = {
  recess: "bg-violet-100 text-violet-800",
  collective_vacation: "bg-sky-100 text-sky-800",
  individual_vacation: "bg-teal-100 text-teal-800",
  event: "bg-amber-100 text-amber-800",
  training: "bg-emerald-100 text-emerald-800",
  maintenance: "bg-orange-100 text-orange-800",
};

export type PlanItem = {
  id: string;
  type: PlanItemType;
  startsDate: string; // YYYY-MM-DD
  endsDate: string;
  title: string | null;
  note: string | null;
  userIds: string[];
};

export type PlanItemRow = {
  id: string;
  type: PlanItemType;
  starts_date: string;
  ends_date: string;
  title: string | null;
  note: string | null;
  agenda_plan_item_people: { user_id: string }[] | null;
};

export function mapPlanItem(row: PlanItemRow): PlanItem {
  return {
    id: row.id,
    type: row.type,
    startsDate: row.starts_date,
    endsDate: row.ends_date,
    title: row.title,
    note: row.note,
    userIds: (row.agenda_plan_item_people ?? []).map((p) => p.user_id),
  };
}

/** Does a plan item cover the given date ("YYYY-MM-DD")? */
export function itemCoversDate(item: PlanItem, dateIso: string): boolean {
  return dateIso >= item.startsDate && dateIso <= item.endsDate;
}

/** Whole-day count of an item (inclusive). */
export function itemDayCount(item: PlanItem): number {
  const s = new Date(`${item.startsDate}T00:00:00`).getTime();
  const e = new Date(`${item.endsDate}T00:00:00`).getTime();
  return Math.round((e - s) / 86_400_000) + 1;
}
