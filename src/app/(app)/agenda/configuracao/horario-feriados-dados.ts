// Leitura do horário por dia e dos feriados da unidade (0368 — Rita, 0A.4).
// Lido À PARTE da configuração da agenda: sem a 0368 num banco, devolve null e
// a tela abre como antes, sem os dois cartões novos.

import type { createClient } from "@/lib/supabase/server";
import { addDaysIso, todayInBrazil } from "@/lib/dates";
import type { EscopoDoFeriado, HorarioDoDia } from "@/lib/unidade-publica";
import type { FeriadoDaUnidade } from "./feriados-da-unidade";

type Banco = Awaited<ReturnType<typeof createClient>>;

type Linha = {
  clinic_id: string | null;
  weekday: number;
  closed: boolean;
  open_time: string | null;
  close_time: string | null;
  lunch_start: string | null;
  lunch_end: string | null;
};

const hm = (t: string | null) => (t ?? "").slice(0, 5);

function paraDias(linhas: Linha[]): HorarioDoDia[] {
  return [0, 1, 2, 3, 4, 5, 6].map((w) => {
    const l = linhas.find((x) => x.weekday === w);
    return {
      weekday: w,
      closed: l ? l.closed : true,
      open: hm(l?.open_time ?? null),
      close: hm(l?.close_time ?? null),
      lunchStart: hm(l?.lunch_start ?? null),
      lunchEnd: hm(l?.lunch_end ?? null),
    };
  });
}

/** Os 7 dias que valem (os da unidade, senão os da rede) e de onde vieram. */
export async function lerHorarioPorDia(
  supabase: Banco,
  clinicId: string | null
): Promise<{ dias: HorarioDoDia[]; origem: "unidade" | "rede" } | null> {
  let consulta = supabase
    .from("clinic_weekday_hours")
    .select("clinic_id, weekday, closed, open_time, close_time, lunch_start, lunch_end");
  consulta = clinicId
    ? consulta.or(`clinic_id.is.null,clinic_id.eq.${clinicId}`)
    : consulta.is("clinic_id", null);
  const { data, error } = await consulta.returns<Linha[]>();
  if (error) return null;
  const daUnidade = clinicId ? (data ?? []).filter((l) => l.clinic_id === clinicId) : [];
  if (daUnidade.length > 0) return { dias: paraDias(daUnidade), origem: "unidade" };
  return { dias: paraDias((data ?? []).filter((l) => l.clinic_id === null)), origem: "rede" };
}

/** Os feriados que valem para a unidade nos próximos 12 meses, com a decisão. */
export async function lerFeriadosDaUnidade(
  supabase: Banco,
  clinica: { id: string; state: string | null; city: string | null },
  isAdmin: boolean
): Promise<FeriadoDaUnidade[] | null> {
  const de = todayInBrazil();
  const ate = addDaysIso(de, 365);
  const uf = (clinica.state ?? "").trim().toUpperCase();
  const cidade = (clinica.city ?? "").trim().toLowerCase();
  const [{ data: feriados, error }, { data: decisoes }] = await Promise.all([
    supabase
      .from("holidays")
      .select("id, holiday_date, name, scope, state, city")
      .gte("holiday_date", de)
      .lte("holiday_date", ate)
      .order("holiday_date")
      .returns<{ id: string; holiday_date: string; name: string; scope: EscopoDoFeriado; state: string | null; city: string | null }[]>(),
    supabase
      .from("clinic_holiday_decisions")
      .select("holiday_date, will_attend")
      .eq("clinic_id", clinica.id)
      .gte("holiday_date", de)
      .lte("holiday_date", ate)
      .returns<{ holiday_date: string; will_attend: boolean }[]>(),
  ]);
  if (error) return null;
  const decisao = new Map((decisoes ?? []).map((d) => [d.holiday_date, d.will_attend]));
  return (feriados ?? [])
    .filter(
      (f) =>
        f.scope === "national" ||
        (f.scope === "state" && f.state === uf) ||
        (f.scope === "city" && f.state === uf && (f.city ?? "").trim().toLowerCase() === cidade)
    )
    .map((f) => ({
      id: f.id,
      date: f.holiday_date,
      name: f.name,
      scope: f.scope,
      decisao: decisao.has(f.holiday_date) ? decisao.get(f.holiday_date)! : null,
      podeRemover: isAdmin || f.scope !== "national",
    }));
}
