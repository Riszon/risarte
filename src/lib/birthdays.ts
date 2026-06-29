// Helpers de aniversário, compartilhados entre a aba "Aniversariantes" dos
// Prontuários e o aviso da Recepção (que antecipa fim de semana/feriado).
// Datas de nascimento são strings YYYY-MM-DD (sem fuso) — comparadas por
// mês/dia, independentemente do ano.

export type BirthdayClient = {
  id: string;
  fullName: string;
  birthDate: string; // YYYY-MM-DD
  phone: string | null;
  status?: "active" | "inactive" | "anonymized";
};

/** Mês (1-12) e dia de uma data YYYY-MM-DD, sem criar Date (evita fuso). */
export function birthMonthDay(birthIso: string): { month: number; day: number } {
  const parts = birthIso.split("-");
  return { month: Number(parts[1]), day: Number(parts[2]) };
}

/** Verdadeiro quando o aniversário (mês/dia) cai exatamente na data dada. */
export function isBirthdayOn(birthIso: string, date: Date): boolean {
  const { month, day } = birthMonthDay(birthIso);
  return date.getMonth() + 1 === month && date.getDate() === day;
}

/** Idade que a pessoa completa/completou no ano da data dada. */
export function ageOn(birthIso: string, date: Date): number {
  return date.getFullYear() - Number(birthIso.slice(0, 4));
}

/**
 * Dias a partir de `from` (00:00) até a próxima ocorrência do aniversário.
 * 0 = hoje; 1 = amanhã; etc. Útil para ordenar "próximos aniversariantes".
 */
export function daysUntilBirthday(birthIso: string, from: Date): number {
  const { month, day } = birthMonthDay(birthIso);
  const base = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  let next = new Date(from.getFullYear(), month - 1, day);
  if (next.getTime() < base.getTime()) {
    next = new Date(from.getFullYear() + 1, month - 1, day);
  }
  return Math.round((next.getTime() - base.getTime()) / 86_400_000);
}

export type BirthdayScope = "hoje" | "semana" | "mes";

export const BIRTHDAY_SCOPE_LABELS: Record<BirthdayScope, string> = {
  hoje: "Hoje",
  semana: "Esta semana",
  mes: "Este mês",
};

/**
 * Filtra/ordena os aniversariantes conforme a faixa escolhida:
 * - hoje: aniversário é hoje;
 * - semana: nos próximos 7 dias (hoje incluído);
 * - mes: qualquer dia do mês corrente.
 */
export function filterBirthdays(
  people: BirthdayClient[],
  scope: BirthdayScope,
  from: Date
): (BirthdayClient & { daysUntil: number; turningAge: number })[] {
  const month = from.getMonth() + 1;
  const enriched = people.map((p) => {
    const daysUntil = daysUntilBirthday(p.birthDate, from);
    const next = new Date(
      from.getFullYear(),
      from.getMonth(),
      from.getDate() + daysUntil
    );
    return { ...p, daysUntil, turningAge: ageOn(p.birthDate, next) };
  });
  let list: typeof enriched;
  if (scope === "hoje") {
    list = enriched.filter((p) => p.daysUntil === 0);
  } else if (scope === "semana") {
    list = enriched.filter((p) => p.daysUntil <= 6);
  } else {
    list = enriched.filter((p) => birthMonthDay(p.birthDate).month === month);
  }
  if (scope === "mes") {
    return list.sort(
      (a, b) =>
        birthMonthDay(a.birthDate).day - birthMonthDay(b.birthDate).day ||
        a.fullName.localeCompare(b.fullName)
    );
  }
  return list.sort(
    (a, b) => a.daysUntil - b.daysUntil || a.fullName.localeCompare(b.fullName)
  );
}
