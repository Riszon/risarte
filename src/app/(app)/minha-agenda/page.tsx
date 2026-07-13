import type { Metadata } from "next";
import Link from "next/link";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { FilterForm } from "@/components/filter-form";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  APPOINTMENT_TYPE_LABELS,
  type AppointmentType,
  type AttendanceStatus,
} from "@/lib/appointments";

export const metadata: Metadata = { title: "Minha Agenda" };

type AgendaRow = {
  id: string;
  clinic_id: string;
  clinic_name: string;
  starts_at: string;
  ends_at: string;
  type: AppointmentType;
  status: string;
  attendance: AttendanceStatus | null;
  client_id: string | null;
  client_name: string | null;
  role: "principal" | "participante";
  is_joint: boolean;
};

const UNIT_COLORS = [
  "bg-blue-100 text-blue-800 border-blue-300",
  "bg-emerald-100 text-emerald-800 border-emerald-300",
  "bg-violet-100 text-violet-800 border-violet-300",
  "bg-amber-100 text-amber-800 border-amber-300",
  "bg-rose-100 text-rose-800 border-rose-300",
  "bg-cyan-100 text-cyan-800 border-cyan-300",
];
const UNIT_FALLBACK = "bg-slate-100 text-slate-800 border-slate-300";

const ATTENDANCE_LABEL: Record<AttendanceStatus, string> = {
  waiting: "Em espera",
  in_service: "Em atendimento",
  done: "Concluído",
  gave_up: "Desistiu",
};

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // segunda como início
  d.setDate(d.getDate() + diff);
  return d;
}
function time(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function MinhaAgendaPage(props: PageProps<"/minha-agenda">) {
  const session = await getSessionContext();
  const isDentistAnywhere =
    session.isAdminMaster ||
    Object.values(session.rolesByClinic).flat().includes("dentist");

  if (!isDentistAnywhere) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">Minha Agenda</h1>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Somente para o dentista</CardTitle>
            <CardDescription>
              Aqui o dentista vê a agenda de todas as unidades em que atende,
              numa única tela.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const searchParams = await props.searchParams;
  const weekOffset = Number.parseInt(
    typeof searchParams.semana === "string" ? searchParams.semana : "0",
    10
  );
  const offset = Number.isFinite(weekOffset) ? weekOffset : 0;
  const unitFilter =
    typeof searchParams.unidade === "string" ? searchParams.unidade : "";

  const weekStart = startOfWeek(new Date());
  weekStart.setDate(weekStart.getDate() + offset * 7);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const supabase = await createClient();
  const { data } = await supabase.rpc("provider_multi_unit_agenda", {
    p_from: weekStart.toISOString(),
    p_to: weekEnd.toISOString(),
  });
  const rows = (data ?? []) as AgendaRow[];

  // Unidades do dentista (para o filtro + cores estáveis).
  const unitClinics = session.clinics
    .filter((c) => c.type === "franchise_unit")
    .map((c) => ({ id: c.id, name: c.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  // Se algum atendimento estiver numa unidade fora da lista, acrescenta.
  for (const r of rows) {
    if (!unitClinics.some((u) => u.id === r.clinic_id)) {
      unitClinics.push({ id: r.clinic_id, name: r.clinic_name });
    }
  }
  const colorByClinic = new Map<string, string>();
  unitClinics.forEach((u, i) => {
    colorByClinic.set(u.id, UNIT_COLORS[i % UNIT_COLORS.length]);
  });

  const shown = unitFilter
    ? rows.filter((r) => r.clinic_id === unitFilter)
    : rows;

  // Agrupa por dia (segunda a domingo).
  const days: { date: Date; items: AgendaRow[] }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    days.push({ date: d, items: [] });
  }
  for (const r of shown) {
    const idx = Math.floor(
      (new Date(r.starts_at).setHours(0, 0, 0, 0) - weekStart.getTime()) /
        86400000
    );
    if (idx >= 0 && idx < 7) days[idx].items.push(r);
  }

  const weekLabel = `${weekStart.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  })} a ${new Date(weekEnd.getTime() - 864e5).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })}`;
  const todayKey = new Date().setHours(0, 0, 0, 0);
  const params = (o: number, u: string) => {
    const sp = new URLSearchParams();
    if (o !== 0) sp.set("semana", String(o));
    if (u) sp.set("unidade", u);
    const q = sp.toString();
    return q ? `?${q}` : "";
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Minha Agenda</h1>
          <p className="text-sm text-muted-foreground">
            Todas as suas unidades numa só agenda · semana de {weekLabel}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/minha-agenda${params(offset - 1, unitFilter)}`}
            className="rounded-md border px-2.5 py-1.5 text-sm hover:bg-accent"
          >
            ← Anterior
          </Link>
          <Link
            href={`/minha-agenda${params(0, unitFilter)}`}
            className="rounded-md border px-2.5 py-1.5 text-sm hover:bg-accent"
          >
            Esta semana
          </Link>
          <Link
            href={`/minha-agenda${params(offset + 1, unitFilter)}`}
            className="rounded-md border px-2.5 py-1.5 text-sm hover:bg-accent"
          >
            Próxima →
          </Link>
        </div>
      </div>

      {unitClinics.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <FilterForm className="flex items-center gap-2">
            <input type="hidden" name="semana" value={offset} />
            <select
              name="unidade"
              defaultValue={unitFilter}
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
            >
              <option value="">Todas as unidades</option>
              {unitClinics.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </FilterForm>
          <div className="flex flex-wrap gap-1.5">
            {unitClinics.map((u) => (
              <span
                key={u.id}
                className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] ${
                  colorByClinic.get(u.id) ?? UNIT_FALLBACK
                }`}
              >
                {u.name}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3">
        {days.map((d) => {
          const isToday = d.date.setHours(0, 0, 0, 0) === todayKey;
          return (
            <Card key={d.date.toISOString()}>
              <CardHeader className="py-3">
                <CardTitle className="text-sm">
                  {d.date.toLocaleDateString("pt-BR", {
                    weekday: "long",
                    day: "2-digit",
                    month: "2-digit",
                  })}
                  {isToday && (
                    <Badge className="ml-2 bg-gold text-gold-foreground">
                      Hoje
                    </Badge>
                  )}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {d.items.length} atendimento(s)
                  </span>
                </CardTitle>
              </CardHeader>
              {d.items.length > 0 && (
                <CardContent className="pt-0">
                  <ul className="space-y-1.5">
                    {d.items.map((r) => (
                      <li
                        key={r.id}
                        className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="font-mono text-xs tabular-nums text-muted-foreground">
                            {time(r.starts_at)}
                          </span>
                          <span
                            className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${
                              colorByClinic.get(r.clinic_id) ?? UNIT_FALLBACK
                            }`}
                          >
                            {r.clinic_name}
                          </span>
                          {r.client_id ? (
                            <Link
                              href={`/prontuarios/${r.client_id}`}
                              className="truncate font-medium hover:underline"
                            >
                              {r.client_name ?? "—"}
                            </Link>
                          ) : (
                            <span className="truncate font-medium">
                              {r.client_name ?? "—"}
                            </span>
                          )}
                          <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                            · {APPOINTMENT_TYPE_LABELS[r.type]}
                          </span>
                          {r.is_joint && (
                            <Badge
                              variant="outline"
                              className="shrink-0 border-amber-300 bg-amber-50 text-amber-700"
                            >
                              {r.role === "participante"
                                ? "Conjunto · você é adicional"
                                : "Atendimento conjunto"}
                            </Badge>
                          )}
                        </div>
                        {r.attendance && (
                          <Badge variant="secondary" className="shrink-0">
                            {ATTENDANCE_LABEL[r.attendance]}
                          </Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
