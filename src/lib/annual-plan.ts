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
  "campaign",
] as const;
export type PlanItemType = (typeof PLAN_ITEM_TYPES)[number];

export const PLAN_ITEM_LABELS: Record<PlanItemType, string> = {
  recess: "Recesso",
  collective_vacation: "Férias coletivas",
  individual_vacation: "Férias individuais",
  event: "Evento",
  training: "Treinamento",
  maintenance: "Manutenção",
  campaign: "Campanha",
};

/** Types that close the whole unit (overridden only by a special open day).
 * "campaign" is informative only — never blocks. */
export const UNIT_BLOCKING_TYPES: PlanItemType[] = [
  "recess",
  "collective_vacation",
  "event",
  "training",
  "maintenance",
];

/** H4.8: tipos que a REDE (franqueadora) pode lançar (sem férias individuais). */
export const NETWORK_PLAN_ITEM_TYPES: PlanItemType[] = [
  "recess",
  "collective_vacation",
  "event",
  "training",
  "maintenance",
  "campaign",
];

export const PLAN_ITEM_CLASS: Record<PlanItemType, string> = {
  recess: "bg-violet-100 text-violet-800",
  collective_vacation: "bg-sky-100 text-sky-800",
  individual_vacation: "bg-teal-100 text-teal-800",
  event: "bg-amber-100 text-amber-800",
  training: "bg-emerald-100 text-emerald-800",
  maintenance: "bg-orange-100 text-orange-800",
  campaign: "bg-pink-100 text-pink-800",
};

export type PlanItem = {
  id: string;
  type: PlanItemType;
  startsDate: string; // YYYY-MM-DD
  endsDate: string;
  title: string | null;
  note: string | null;
  userIds: string[];
  /** H4.8: item da rede (clinic_id NULL) trava/decisão da unidade. */
  isNetwork: boolean;
  locked: boolean;
};

export type PlanItemRow = {
  id: string;
  type: PlanItemType;
  starts_date: string;
  ends_date: string;
  title: string | null;
  note: string | null;
  /** Presente só nas consultas que pedem estas colunas (H4.8). */
  clinic_id?: string | null;
  locked?: boolean | null;
  agenda_plan_item_people?: { user_id: string }[] | null;
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
    // clinic_id ausente na query = item de unidade (não é da rede).
    isNetwork: row.clinic_id === null,
    locked: row.locked ?? false,
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
