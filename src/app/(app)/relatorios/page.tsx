import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Input } from "@/components/ui/input";
import { FilterForm } from "@/components/filter-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_TYPE_LABELS,
  APPOINTMENT_STATUSES,
  APPOINTMENT_TYPES,
  type AppointmentStatus,
  type AppointmentType,
} from "@/lib/appointments";
import {
  JOURNEY_PHASES,
  PHASE_LABELS,
  type JourneyPhase,
} from "@/lib/journey";
import type { TreatmentPlanStatus } from "@/lib/planning";

export const metadata: Metadata = { title: "Relatórios" };

const selectClass =
  "h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm";

/** Date range for the period filter. */
function periodRange(
  periodo: string,
  de: string,
  ate: string
): { from: string | null; to: string | null } {
  const now = new Date();
  if (periodo === "dia") {
    const s = new Date(now);
    s.setHours(0, 0, 0, 0);
    return { from: s.toISOString(), to: null };
  }
  if (periodo === "semana") {
    const s = new Date(now);
    const diff = (s.getDay() + 6) % 7;
    s.setDate(s.getDate() - diff);
    s.setHours(0, 0, 0, 0);
    return { from: s.toISOString(), to: null };
  }
  if (periodo === "mes" || periodo === "") {
    return {
      from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
      to: null,
    };
  }
  if (periodo === "periodo") {
    return {
      from: de ? new Date(`${de}T00:00:00`).toISOString() : null,
      to: ate ? new Date(`${ate}T23:59:59`).toISOString() : null,
    };
  }
  return { from: null, to: null };
}

function inRange(iso: string | null, from: string | null, to: string | null) {
  if (!iso) return false;
  if (from && iso < from) return false;
  if (to && iso > to) return false;
  return true;
}

export default async function ReportsPage(props: PageProps<"/relatorios">) {
  const session = await getSessionContext();
  const MGMT_ROLES = [
    "unit_manager",
    "planner_dentist",
    "franchisee",
    "franchisor_staff",
    "commercial_consultant",
  ];
  const canView =
    session.isAdminMaster ||
    Object.values(session.rolesByClinic).some((roles) =>
      roles.some((r) => MGMT_ROLES.includes(r))
    );
  if (!canView) redirect("/");

  const sp = await props.searchParams;
  const periodo = typeof sp.periodo === "string" ? sp.periodo : "mes";
  const de = typeof sp.de === "string" ? sp.de : "";
  const ate = typeof sp.ate === "string" ? sp.ate : "";
  const unidade = typeof sp.unidade === "string" ? sp.unidade : "";
  const range = periodRange(periodo, de, ate);

  const supabase = await createClient();

  // -- Agendamentos no período (RLS limita às unidades visíveis) --
  let apptQuery = supabase
    .from("appointments")
    .select(
      "type, status, provider_user_id, clinic_id, clinics ( name ), provider:profiles!appointments_provider_user_id_fkey ( full_name )"
    )
    .limit(5000);
  if (range.from) apptQuery = apptQuery.gte("starts_at", range.from);
  if (range.to) apptQuery = apptQuery.lte("starts_at", range.to);
  if (unidade) apptQuery = apptQuery.eq("clinic_id", unidade);

  const [{ data: appts }, { data: clientRows }, { data: planRows }, { data: units }] =
    await Promise.all([
      apptQuery.returns<
        {
          type: AppointmentType;
          status: AppointmentStatus;
          provider_user_id: string | null;
          clinic_id: string;
          clinics: { name: string } | null;
          provider: { full_name: string } | null;
        }[]
      >(),
      // B5: clientes por unidade/fase (somente contagens, sem nomes).
      supabase
        .from("clients")
        .select("journey_phase, clinic_id, clinics!clients_clinic_id_fkey ( name )")
        .neq("status", "anonymized")
        .limit(5000)
        .returns<
          {
            journey_phase: JourneyPhase;
            clinic_id: string;
            clinics: { name: string } | null;
          }[]
        >(),
      // B6: planos do Planner.
      supabase
        .from("treatment_plans")
        .select("status, created_at, submitted_at, reviewed_at")
        .limit(5000)
        .returns<
          {
            status: TreatmentPlanStatus;
            created_at: string;
            submitted_at: string | null;
            reviewed_at: string | null;
          }[]
        >(),
      supabase
        .from("clinics")
        .select("id, name")
        .eq("type", "franchise_unit")
        .eq("is_active", true)
        .order("name"),
    ]);

  // ---- B4: quadros-resumo de agendamentos ----
  const byStatus = {} as Record<AppointmentStatus, number>;
  for (const s of APPOINTMENT_STATUSES) byStatus[s] = 0;
  const byType = {} as Record<AppointmentType, number>;
  for (const t of APPOINTMENT_TYPES) byType[t] = 0;
  const byProvider = new Map<string, { name: string; count: number }>();
  const byUnit = new Map<string, { name: string; count: number }>();
  for (const a of appts ?? []) {
    byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
    byType[a.type] = (byType[a.type] ?? 0) + 1;
    const pid = a.provider_user_id ?? "—";
    const pe = byProvider.get(pid) ?? {
      name: a.provider?.full_name ?? "Sem profissional",
      count: 0,
    };
    pe.count += 1;
    byProvider.set(pid, pe);
    const ue = byUnit.get(a.clinic_id) ?? {
      name: a.clinics?.name ?? "—",
      count: 0,
    };
    ue.count += 1;
    byUnit.set(a.clinic_id, ue);
  }
  const totalAppts = (appts ?? []).length;

  // ---- B5: rede por unidade/fase (contagens, sem nomes) ----
  const phaseByUnit = new Map<string, { name: string; counts: Record<string, number> }>();
  const phaseTotals = {} as Record<string, number>;
  for (const p of JOURNEY_PHASES) phaseTotals[p] = 0;
  for (const c of clientRows ?? []) {
    if (unidade && c.clinic_id !== unidade) continue;
    const e = phaseByUnit.get(c.clinic_id) ?? {
      name: c.clinics?.name ?? "—",
      counts: {},
    };
    e.counts[c.journey_phase] = (e.counts[c.journey_phase] ?? 0) + 1;
    phaseByUnit.set(c.clinic_id, e);
    phaseTotals[c.journey_phase] = (phaseTotals[c.journey_phase] ?? 0) + 1;
  }

  // ---- B6: contadores do Planner ----
  const plans = planRows ?? [];
  const plansCreated = plans.filter((p) =>
    inRange(p.created_at, range.from, range.to)
  ).length;
  const plansSubmitted = plans.filter((p) =>
    inRange(p.submitted_at, range.from, range.to)
  ).length;
  const plansApproved = plans.filter(
    (p) => p.status === "approved" && inRange(p.reviewed_at, range.from, range.to)
  );
  const plansReturned = plans.filter(
    (p) => p.status === "returned" && inRange(p.reviewed_at, range.from, range.to)
  ).length;
  const avgDays =
    plansApproved.length > 0
      ? plansApproved.reduce((sum, p) => {
          const d =
            (new Date(p.reviewed_at!).getTime() -
              new Date(p.created_at).getTime()) /
            86400000;
          return sum + Math.max(0, d);
        }, 0) / plansApproved.length
      : null;

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Relatórios</h1>
        <p className="text-sm text-muted-foreground">
          Quadros-resumo de agendamentos, visão da rede por fase (sem nomes de
          pacientes) e produtividade do Centro de Planejamento.
        </p>
      </div>

      <FilterForm className="flex flex-wrap items-center gap-2">
        <label className="text-sm text-muted-foreground">Período:</label>
        <select name="periodo" defaultValue={periodo} className={selectClass}>
          <option value="dia">Hoje</option>
          <option value="semana">Esta semana</option>
          <option value="mes">Este mês</option>
          <option value="periodo">Período específico</option>
          <option value="tudo">Tudo</option>
        </select>
        {periodo === "periodo" && (
          <>
            <Input type="date" name="de" defaultValue={de} className="w-auto" />
            <span className="text-sm text-muted-foreground">até</span>
            <Input type="date" name="ate" defaultValue={ate} className="w-auto" />
          </>
        )}
        <select name="unidade" defaultValue={unidade} className={selectClass}>
          <option value="">Todas as unidades</option>
          {(units ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </FilterForm>

      {/* B4 — agendamentos */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Agendamentos no período ({totalAppts})
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <h3 className="mb-1 text-sm font-medium">Por situação</h3>
            <ul className="space-y-0.5 text-sm">
              {APPOINTMENT_STATUSES.map((s) => (
                <li key={s} className="flex justify-between">
                  <span className="text-muted-foreground">
                    {APPOINTMENT_STATUS_LABELS[s]}
                  </span>
                  <span className="font-medium">{byStatus[s]}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-1 text-sm font-medium">Por tipo</h3>
            <ul className="space-y-0.5 text-sm">
              {APPOINTMENT_TYPES.filter((t) => byType[t] > 0).map((t) => (
                <li key={t} className="flex justify-between">
                  <span className="text-muted-foreground">
                    {APPOINTMENT_TYPE_LABELS[t]}
                  </span>
                  <span className="font-medium">{byType[t]}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-1 text-sm font-medium">Por profissional</h3>
            <ul className="space-y-0.5 text-sm">
              {[...byProvider.values()]
                .sort((a, b) => b.count - a.count)
                .map((p, i) => (
                  <li key={i} className="flex justify-between">
                    <span className="truncate text-muted-foreground">{p.name}</span>
                    <span className="font-medium">{p.count}</span>
                  </li>
                ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-1 text-sm font-medium">Por unidade</h3>
            <ul className="space-y-0.5 text-sm">
              {[...byUnit.values()]
                .sort((a, b) => b.count - a.count)
                .map((u, i) => (
                  <li key={i} className="flex justify-between">
                    <span className="truncate text-muted-foreground">{u.name}</span>
                    <span className="font-medium">{u.count}</span>
                  </li>
                ))}
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* B5 — rede por fase, sem nomes */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Rede por fase da jornada (clientes, sem nomes)
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-2 py-1 font-medium">Unidade</th>
                {JOURNEY_PHASES.map((p) => (
                  <th key={p} className="px-2 py-1 text-center font-medium">
                    {PHASE_LABELS[p]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...phaseByUnit.values()]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((u, i) => (
                  <tr key={i} className="border-b">
                    <td className="px-2 py-1 font-medium">{u.name}</td>
                    {JOURNEY_PHASES.map((p) => (
                      <td key={p} className="px-2 py-1 text-center">
                        {u.counts[p] ?? 0}
                      </td>
                    ))}
                  </tr>
                ))}
              <tr className="font-medium">
                <td className="px-2 py-1">Total</td>
                {JOURNEY_PHASES.map((p) => (
                  <td key={p} className="px-2 py-1 text-center">
                    {phaseTotals[p] ?? 0}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* B6 — produtividade do Planner */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Produtividade do Centro de Planejamento (no período)
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <Metric label="Planos criados" value={plansCreated} />
          <Metric label="Enviados para aprovação" value={plansSubmitted} />
          <Metric label="Aprovados" value={plansApproved.length} />
          <Metric label="Devolvidos" value={plansReturned} />
          <Metric
            label="Tempo médio (criação → aprovação)"
            value={avgDays === null ? "—" : `${avgDays.toFixed(1)} dias`}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-2xl font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
