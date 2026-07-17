import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  CircleCheck,
  Clock,
  FilePlus2,
  Send,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { fullAccessClinicIds, getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
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

/** Pontinho de cor por situação (mesma paleta da Agenda/Atendimento). */
const STATUS_DOT: Record<AppointmentStatus, string> = {
  scheduled: "bg-sky-500",
  confirmed: "bg-emerald-500",
  completed: "bg-zinc-400",
  cancelled: "bg-red-500",
  no_show: "bg-orange-500",
};

/** Linha com barra de proporção (peso relativo ao maior valor da lista). */
function BarRow({
  name,
  count,
  max,
}: {
  name: string;
  count: number;
  max: number;
}) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <li>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="truncate text-muted-foreground">{name}</span>
        <span className="font-medium tabular-nums">{count}</span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-black/5">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${pct}%` }}
        />
      </div>
    </li>
  );
}

const METRIC_TONE = {
  neutral: { card: "border bg-muted/20", icon: "text-muted-foreground", val: "" },
  blue: { card: "border bg-muted/20", icon: "text-sky-700", val: "" },
  green: {
    card: "border-emerald-200 bg-emerald-50/60",
    icon: "text-emerald-700",
    val: "text-emerald-800",
  },
  amber: {
    card: "border-amber-200 bg-amber-50/60",
    icon: "text-amber-700",
    val: "text-amber-800",
  },
  navy: {
    card: "border-primary/20 bg-primary/5",
    icon: "text-primary",
    val: "text-primary",
  },
} as const;

export default async function ReportsPage(props: PageProps<"/relatorios">) {
  const session = await getSessionContext();

  // O papel de gestão vale na CLÍNICA ATIVA (trocar de unidade troca o chapéu):
  // Admin = tudo; Franqueadora (staff/planner/consultor) = escopo de unidades;
  // Gerente = a unidade ativa; Franqueado = as unidades que possui.
  const active = session.activeClinic;
  const activeRoles = active ? (session.rolesByClinic[active.id] ?? []) : [];
  const FRANCHISOR_REPORT_ROLES = [
    "franchisor_staff",
    "planner_dentist",
    "commercial_consultant",
  ];
  let scopeIds: string[] | null = null; // null = sem restrição (Admin Master)
  if (!session.isAdminMaster) {
    if (
      active?.type === "franchisor" &&
      activeRoles.some((r) => FRANCHISOR_REPORT_ROLES.includes(r))
    ) {
      scopeIds = await fullAccessClinicIds();
    } else if (activeRoles.includes("franchisee")) {
      scopeIds = Object.entries(session.rolesByClinic)
        .filter(([, roles]) => roles.includes("franchisee"))
        .map(([id]) => id);
    } else if (active && activeRoles.includes("unit_manager")) {
      scopeIds = [active.id];
    } else {
      redirect("/");
    }
    if (scopeIds !== null && scopeIds.length === 0) redirect("/");
  }

  const sp = await props.searchParams;
  const periodo = typeof sp.periodo === "string" ? sp.periodo : "mes";
  const de = typeof sp.de === "string" ? sp.de : "";
  const ate = typeof sp.ate === "string" ? sp.ate : "";
  const unidadeParam = typeof sp.unidade === "string" ? sp.unidade : "";
  // Só aceita o filtro de unidade dentro do escopo permitido.
  const unidade =
    unidadeParam && (scopeIds === null || scopeIds.includes(unidadeParam))
      ? unidadeParam
      : "";
  const range = periodRange(periodo, de, ate);

  const supabase = await createClient();

  // -- Agendamentos no período (escopo aplicado explicitamente, além da RLS) --
  let apptQuery = supabase
    .from("appointments")
    .select(
      "type, status, provider_user_id, clinic_id, clinics ( name ), provider:profiles!appointments_provider_user_id_fkey ( full_name )"
    )
    .limit(5000);
  if (range.from) apptQuery = apptQuery.gte("starts_at", range.from);
  if (range.to) apptQuery = apptQuery.lte("starts_at", range.to);
  if (scopeIds) apptQuery = apptQuery.in("clinic_id", scopeIds);
  if (unidade) apptQuery = apptQuery.eq("clinic_id", unidade);

  // B5: clientes por unidade/fase (somente contagens, sem nomes).
  let clientQuery = supabase
    .from("clients")
    .select("journey_phase, clinic_id, clinics!clients_clinic_id_fkey ( name )")
    .neq("status", "anonymized")
    .limit(5000);
  if (scopeIds) clientQuery = clientQuery.in("clinic_id", scopeIds);

  // B6: planos do Planner.
  let planQuery = supabase
    .from("treatment_plans")
    .select("status, created_at, submitted_at, reviewed_at")
    .limit(5000);
  if (scopeIds) planQuery = planQuery.in("clinic_id", scopeIds);
  if (unidade) planQuery = planQuery.eq("clinic_id", unidade);

  // Opções do filtro de unidade: só as unidades do escopo.
  let unitsQuery = supabase
    .from("clinics")
    .select("id, name")
    .eq("type", "franchise_unit")
    .eq("is_active", true)
    .order("name");
  if (scopeIds) unitsQuery = unitsQuery.in("id", scopeIds);

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
      clientQuery.returns<
        {
          journey_phase: JourneyPhase;
          clinic_id: string;
          clinics: { name: string } | null;
        }[]
      >(),
      planQuery.returns<
        {
          status: TreatmentPlanStatus;
          created_at: string;
          submitted_at: string | null;
          reviewed_at: string | null;
        }[]
      >(),
      unitsQuery,
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
  const typeMax = Math.max(1, ...APPOINTMENT_TYPES.map((t) => byType[t]));
  const provList = [...byProvider.values()].sort((a, b) => b.count - a.count);
  const unitList = [...byUnit.values()].sort((a, b) => b.count - a.count);
  const provMax = Math.max(1, ...provList.map((p) => p.count));
  const unitMax = Math.max(1, ...unitList.map((u) => u.count));

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
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Relatórios</h1>
          <p className="text-sm text-muted-foreground">
            Quadros-resumo de agendamentos, visão da rede por fase (sem nomes de
            pacientes) e produtividade do Centro de Planejamento.
          </p>
        </div>
        <FilterForm className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2">
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
      </div>

      {/* B4 — agendamentos */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Agendamentos no período ({totalAppts})
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <div>
            <h3 className="mb-2 text-xs font-medium text-muted-foreground">
              Por situação
            </h3>
            <ul className="space-y-1 text-sm">
              {APPOINTMENT_STATUSES.map((s) => (
                <li key={s} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <span
                      className={cn(
                        "size-2 shrink-0 rounded-full",
                        STATUS_DOT[s]
                      )}
                    />
                    {APPOINTMENT_STATUS_LABELS[s]}
                  </span>
                  <span className="font-medium tabular-nums">{byStatus[s]}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-2 text-xs font-medium text-muted-foreground">
              Por tipo
            </h3>
            <ul className="space-y-2">
              {APPOINTMENT_TYPES.filter((t) => byType[t] > 0).map((t) => (
                <BarRow
                  key={t}
                  name={APPOINTMENT_TYPE_LABELS[t]}
                  count={byType[t]}
                  max={typeMax}
                />
              ))}
              {APPOINTMENT_TYPES.every((t) => byType[t] === 0) && (
                <p className="text-sm text-muted-foreground">—</p>
              )}
            </ul>
          </div>
          <div>
            <h3 className="mb-2 text-xs font-medium text-muted-foreground">
              Por profissional
            </h3>
            <ul className="space-y-2">
              {provList.map((p, i) => (
                <BarRow key={i} name={p.name} count={p.count} max={provMax} />
              ))}
              {provList.length === 0 && (
                <p className="text-sm text-muted-foreground">—</p>
              )}
            </ul>
          </div>
          <div>
            <h3 className="mb-2 text-xs font-medium text-muted-foreground">
              Por unidade
            </h3>
            <ul className="space-y-2">
              {unitList.map((u, i) => (
                <BarRow key={i} name={u.name} count={u.count} max={unitMax} />
              ))}
              {unitList.length === 0 && (
                <p className="text-sm text-muted-foreground">—</p>
              )}
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
            <thead>
              <tr className="border-b text-left text-xs">
                <th className="px-2 py-2 font-medium text-muted-foreground">
                  Unidade
                </th>
                {JOURNEY_PHASES.map((p, i) => (
                  <th key={p} className="px-2 py-2 text-center font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                        {i + 1}
                      </span>
                      <span className="whitespace-nowrap text-muted-foreground">
                        {PHASE_LABELS[p]}
                      </span>
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...phaseByUnit.values()]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((u, i) => (
                  <tr key={i} className="border-b even:bg-muted/20">
                    <td className="px-2 py-1.5 font-medium">{u.name}</td>
                    {JOURNEY_PHASES.map((p) => {
                      const n = u.counts[p] ?? 0;
                      return (
                        <td
                          key={p}
                          className={cn(
                            "px-2 py-1.5 text-center tabular-nums",
                            n === 0 && "text-muted-foreground/50"
                          )}
                        >
                          {n}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              {phaseByUnit.size === 0 && (
                <tr>
                  <td
                    colSpan={JOURNEY_PHASES.length + 1}
                    className="px-2 py-3 text-center text-sm text-muted-foreground"
                  >
                    Sem clientes no escopo.
                  </td>
                </tr>
              )}
              <tr className="border-t-2 bg-muted/40 font-medium">
                <td className="px-2 py-1.5">Total</td>
                {JOURNEY_PHASES.map((p) => (
                  <td key={p} className="px-2 py-1.5 text-center tabular-nums">
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
        <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Metric
            label="Planos criados"
            value={plansCreated}
            icon={FilePlus2}
            tone="neutral"
          />
          <Metric
            label="Enviados para aprovação"
            value={plansSubmitted}
            icon={Send}
            tone="blue"
          />
          <Metric
            label="Aprovados"
            value={plansApproved.length}
            icon={CircleCheck}
            tone="green"
          />
          <Metric
            label="Devolvidos"
            value={plansReturned}
            icon={Undo2}
            tone="amber"
          />
          <Metric
            label="Tempo médio (criação → aprovação)"
            value={avgDays === null ? "—" : `${avgDays.toFixed(1)} dias`}
            icon={Clock}
            tone="navy"
          />
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number | string;
  icon: LucideIcon;
  tone: keyof typeof METRIC_TONE;
}) {
  const t = METRIC_TONE[tone];
  return (
    <div className={cn("rounded-lg p-3", t.card)}>
      <Icon className={cn("size-4", t.icon)} />
      <p className={cn("mt-1 text-2xl font-semibold tabular-nums", t.val)}>
        {value}
      </p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
