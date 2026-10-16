import { startOfDayInBrazil } from "@/lib/dates";
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

/**
 * O QUE O PLANEJAMENTO ANUAL FAZ COM UM DIA, para quem agenda (AP41,
 * decisão do dono 15/10/2026: "a agenda segue a regra escrita").
 *
 * - `bloqueia`: ninguém marca — férias do profissional escolhido, ou período
 *   da REDE travado (nem dia avulso abre).
 * - `fechaODia`: período da unidade (ou da rede, sem trava) — o dia está
 *   FECHADO. Um dia avulso abre, mas aí vale SÓ a janela do avulso (AJ7:
 *   "num dia fechado com dia avulso, usa só a janela do avulso"). Antes a
 *   agenda tratava o recesso de uma segunda como dia normal e UNIA as
 *   janelas — aceitava o horário inteiro.
 *
 * Campanha é informativa. O online só é alcançado pelas férias da própria
 * pessoa (0268): o fechamento da unidade não fecha o consultor remoto.
 *
 * A validação do agendamento e a lista de próximos horários usam esta regra —
 * duas réguas para o mesmo dia é como uma oferece o que a outra recusa.
 */
export function situacaoDoPlanoNoDia(
  items: readonly PlanItem[],
  dateIso: string,
  providerId: string | null,
  isOnline: boolean
): { bloqueia: boolean; fechaODia: boolean } {
  let bloqueia = false;
  let fechaODia = false;
  for (const item of items) {
    if (!itemCoversDate(item, dateIso) || item.type === "campaign") continue;
    if (item.type === "individual_vacation") {
      if (providerId && item.userIds.includes(providerId)) bloqueia = true;
      continue;
    }
    if (isOnline) continue;
    if (item.isNetwork && item.locked) bloqueia = true;
    else fechaODia = true;
  }
  return { bloqueia, fechaODia };
}

/** Whole-day count of an item (inclusive). */
export function itemDayCount(item: PlanItem): number {
  // Meia-noite BRASILEIRA nos dois lados (AP4). Antes eram duas
  // meia-noites da MÁQUINA: a diferença dava certo por acaso, porque as duas
  // erravam junto — e bastava alguém mexer em uma para o contador de dias
  // passar a mentir.
  const s = startOfDayInBrazil(item.startsDate).getTime();
  const e = startOfDayInBrazil(item.endsDate).getTime();
  return Math.round((e - s) / 86_400_000) + 1;
}
