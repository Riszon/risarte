// Brazilian national holidays (G5). Fixed dates + movable ones derived from
// Easter (Sexta-feira Santa, Carnaval, Corpus Christi). Dates are plain calendar
// strings "YYYY-MM-DD" (no timezone). The manager confirms per holiday whether
// the unit will attend (clinic_holiday_decisions).

export type Holiday = { date: string; name: string };

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function ymd(year: number, month1: number, day: number): string {
  return `${year}-${pad(month1)}-${pad(day)}`;
}

/** Easter Sunday (Anonymous Gregorian algorithm). Returns 1-based month/day. */
function easter(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

/** Adds `days` to a Y-M-D date and returns it as "YYYY-MM-DD". */
function addDays(year: number, month1: number, day: number, days: number): string {
  const d = new Date(year, month1 - 1, day);
  d.setDate(d.getDate() + days);
  return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

const cache = new Map<number, Holiday[]>();

/** National holidays for a given year. */
export function nationalHolidays(year: number): Holiday[] {
  const cached = cache.get(year);
  if (cached) return cached;

  const e = easter(year);
  const list: Holiday[] = [
    { date: ymd(year, 1, 1), name: "Confraternização Universal" },
    { date: addDays(year, e.month, e.day, -47), name: "Carnaval" },
    { date: addDays(year, e.month, e.day, -2), name: "Sexta-feira Santa" },
    { date: ymd(year, 4, 21), name: "Tiradentes" },
    { date: ymd(year, 5, 1), name: "Dia do Trabalho" },
    { date: addDays(year, e.month, e.day, 60), name: "Corpus Christi" },
    { date: ymd(year, 9, 7), name: "Independência do Brasil" },
    { date: ymd(year, 10, 12), name: "Nossa Senhora Aparecida" },
    { date: ymd(year, 11, 2), name: "Finados" },
    { date: ymd(year, 11, 15), name: "Proclamação da República" },
    { date: ymd(year, 11, 20), name: "Consciência Negra" },
    { date: ymd(year, 12, 25), name: "Natal" },
  ];
  list.sort((a, b) => a.date.localeCompare(b.date));
  cache.set(year, list);
  return list;
}

/** Holidays whose date falls within [startIso, endIso] (inclusive YYYY-MM-DD). */
export function holidaysInRange(startIso: string, endIso: string): Holiday[] {
  const startYear = Number(startIso.slice(0, 4));
  const endYear = Number(endIso.slice(0, 4));
  const out: Holiday[] = [];
  for (let y = startYear; y <= endYear; y++) {
    for (const h of nationalHolidays(y)) {
      if (h.date >= startIso && h.date <= endIso) out.push(h);
    }
  }
  return out;
}

/** The holiday on a given date ("YYYY-MM-DD"), or null. */
export function holidayOn(dateIso: string): Holiday | null {
  const year = Number(dateIso.slice(0, 4));
  if (!year) return null;
  return nationalHolidays(year).find((h) => h.date === dateIso) ?? null;
}
