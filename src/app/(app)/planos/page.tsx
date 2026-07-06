import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { fullAccessClinicIds, getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { FilterForm } from "@/components/filter-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  PHASE_LABELS,
  STATUS_LABELS,
  type JourneyPhase,
  type JourneyStatus,
} from "@/lib/journey";
import type { TreatmentPlanStatus } from "@/lib/planning";

export const metadata: Metadata = { title: "Planos de Tratamento" };

// H4.4: situações da central de planos, na ordem do funil.
const SITUATIONS = [
  "em_planejamento",
  "aguardando_aprovacao",
  "aprovado",
  "fase_comercial",
  "aguardando_inicio",
  "em_tratamento",
  "finalizado",
] as const;
type Situation = (typeof SITUATIONS)[number];

const SITUATION_LABELS: Record<Situation, string> = {
  em_planejamento: "Em planejamento",
  aguardando_aprovacao: "Aguardando aprovação",
  aprovado: "Aprovado — no Centro",
  fase_comercial: "Fase comercial",
  aguardando_inicio: "Aguardando iniciar",
  em_tratamento: "Em tratamento",
  finalizado: "Finalizado",
};

// Cores por situação (chip clicável + selo na tabela).
const SITUATION_STYLES: Record<Situation, { chip: string; dot: string }> = {
  em_planejamento: {
    chip: "border-sky-300 bg-sky-50 text-sky-800",
    dot: "bg-sky-500",
  },
  aguardando_aprovacao: {
    chip: "border-amber-300 bg-amber-50 text-amber-800",
    dot: "bg-amber-500",
  },
  aprovado: {
    chip: "border-emerald-300 bg-emerald-50 text-emerald-800",
    dot: "bg-emerald-500",
  },
  fase_comercial: {
    chip: "border-violet-300 bg-violet-50 text-violet-800",
    dot: "bg-violet-500",
  },
  aguardando_inicio: {
    chip: "border-orange-300 bg-orange-50 text-orange-800",
    dot: "bg-orange-500",
  },
  em_tratamento: {
    chip: "border-gold/50 bg-gold/10 text-primary",
    dot: "bg-gold",
  },
  finalizado: {
    chip: "border-slate-300 bg-slate-100 text-slate-700",
    dot: "bg-slate-500",
  },
};

/** Situação de um plano = status do plano + fase/sub-status do cliente. */
function classify(
  planStatus: TreatmentPlanStatus,
  phase: JourneyPhase | null,
  jStatus: JourneyStatus | null
): Situation {
  if (planStatus === "draft" || planStatus === "returned") {
    return "em_planejamento";
  }
  if (planStatus === "submitted") return "aguardando_aprovacao";
  // Aprovado: a situação segue a jornada do cliente.
  if (
    jStatus === "treatment_finished" ||
    jStatus === "treatment_cancelled" ||
    jStatus === "treatment_partially_cancelled"
  ) {
    return "finalizado";
  }
  if (phase === "commercial_conversion") return "fase_comercial";
  if (phase === "treatment_start") {
    return jStatus === "in_treatment" ? "em_tratamento" : "aguardando_inicio";
  }
  if (phase === "reevaluation" || phase === "follow_up") return "finalizado";
  return "aprovado";
}

type PlanRow = {
  id: string;
  client_id: string;
  clinic_id: string;
  status: TreatmentPlanStatus;
  created_at: string;
  updated_at: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  clinics: { name: string } | null;
  clients: {
    id: string;
    full_name: string;
    code: string | null;
    journey_phase: JourneyPhase;
    journey_status: JourneyStatus | null;
  } | null;
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR");
}

export default async function PlansPage(props: PageProps<"/planos">) {
  const session = await getSessionContext();

  // Escopo por papel, avaliado na CLÍNICA ATIVA (mesma regra de /relatorios):
  // Admin = tudo; Franqueadora (staff/planner/consultor) = escopo de unidades;
  // Coordenador/Gerente = a unidade ativa; Franqueado = as unidades dele.
  const active = session.activeClinic;
  const activeRoles = active ? (session.rolesByClinic[active.id] ?? []) : [];
  const FRANCHISOR_PLAN_ROLES = [
    "franchisor_staff",
    "planner_dentist",
    "commercial_consultant",
  ];
  let scopeIds: string[] | null = null; // null = sem restrição (Admin Master)
  if (!session.isAdminMaster) {
    if (
      active?.type === "franchisor" &&
      activeRoles.some((r) => FRANCHISOR_PLAN_ROLES.includes(r))
    ) {
      scopeIds = await fullAccessClinicIds();
    } else if (activeRoles.includes("franchisee")) {
      scopeIds = Object.entries(session.rolesByClinic)
        .filter(([, roles]) => roles.includes("franchisee"))
        .map(([id]) => id);
    } else if (
      active &&
      activeRoles.some((r) =>
        ["unit_manager", "clinical_coordinator"].includes(r)
      )
    ) {
      scopeIds = [active.id];
    } else {
      redirect("/");
    }
    if (scopeIds !== null && scopeIds.length === 0) redirect("/");
  }

  const searchParams = await props.searchParams;
  const busca = typeof searchParams.busca === "string" ? searchParams.busca : "";
  const unidadeParam =
    typeof searchParams.unidade === "string" ? searchParams.unidade : "";
  const unidade =
    unidadeParam && (scopeIds === null || scopeIds.includes(unidadeParam))
      ? unidadeParam
      : "";
  const situacao = SITUATIONS.includes(searchParams.situacao as Situation)
    ? (searchParams.situacao as Situation)
    : "";

  const supabase = await createClient();

  let planQuery = supabase
    .from("treatment_plans")
    .select(
      "id, client_id, clinic_id, status, created_at, updated_at, submitted_at, reviewed_at, clinics ( name ), clients ( id, full_name, code, journey_phase, journey_status )"
    )
    .order("created_at", { ascending: false })
    .limit(2000);
  if (scopeIds) planQuery = planQuery.in("clinic_id", scopeIds);
  if (unidade) planQuery = planQuery.eq("clinic_id", unidade);

  let unitsQuery = supabase
    .from("clinics")
    .select("id, name")
    .eq("type", "franchise_unit")
    .eq("is_active", true)
    .order("name");
  if (scopeIds) unitsQuery = unitsQuery.in("id", scopeIds);

  const [{ data: planRows }, { data: units }] = await Promise.all([
    planQuery.returns<PlanRow[]>(),
    unitsQuery,
  ]);

  const entries = (planRows ?? [])
    .filter((p) => p.clients)
    .map((p) => ({
      planId: p.id,
      clientId: p.clients!.id,
      clientName: p.clients!.full_name,
      clientCode: p.clients!.code,
      clinicName: p.clinics?.name ?? "—",
      phase: p.clients!.journey_phase,
      jStatus: p.clients!.journey_status,
      situation: classify(
        p.status,
        p.clients!.journey_phase,
        p.clients!.journey_status
      ),
      createdAt: p.created_at,
      lastAt: p.reviewed_at ?? p.submitted_at ?? p.updated_at ?? p.created_at,
    }));

  // H3.15: quais casos na fase comercial JÁ têm apresentação comercial futura
  // agendada. Os que estão em "fase_comercial" e não estão neste conjunto ficam
  // sinalizados (a recepção precisa agendar).
  const commercialClientIds = entries
    .filter((e) => e.situation === "fase_comercial")
    .map((e) => e.clientId);
  const withPresentation = new Set<string>();
  if (commercialClientIds.length > 0) {
    const nowIso = new Date().toISOString();
    const { data: presRows } = await supabase
      .from("appointments")
      .select("client_id")
      .in("client_id", commercialClientIds)
      .eq("type", "commercial_presentation")
      .in("status", ["scheduled", "confirmed"])
      .gte("starts_at", nowIso)
      .returns<{ client_id: string | null }[]>();
    for (const r of presRows ?? []) {
      if (r.client_id) withPresentation.add(r.client_id);
    }
  }
  const missingPresentation = (clientId: string, situation: Situation) =>
    situation === "fase_comercial" && !withPresentation.has(clientId);

  // Busca por nome (aplica antes dos contadores; a situação filtra depois).
  const term = busca.trim().toLowerCase();
  const filtered = term
    ? entries.filter((e) => e.clientName.toLowerCase().includes(term))
    : entries;

  const counts = {} as Record<Situation, number>;
  for (const s of SITUATIONS) counts[s] = 0;
  for (const e of filtered) counts[e.situation] += 1;

  // H3.15: total de casos na fase comercial sem apresentação agendada (banner).
  const missingPresentationCount = filtered.filter((e) =>
    missingPresentation(e.clientId, e.situation)
  ).length;

  const shown = situacao
    ? filtered.filter((e) => e.situation === situacao)
    : filtered;

  // Relatório: quadro unidade × situação + evolução dos aprovados.
  const byUnit = new Map<string, { name: string; counts: Record<string, number> }>();
  for (const e of filtered) {
    const u = byUnit.get(e.clinicName) ?? { name: e.clinicName, counts: {} };
    u.counts[e.situation] = (u.counts[e.situation] ?? 0) + 1;
    byUnit.set(e.clinicName, u);
  }
  const approvedOnward = filtered.filter(
    (e) => !["em_planejamento", "aguardando_aprovacao"].includes(e.situation)
  );
  const reachedTreatment = approvedOnward.filter((e) =>
    ["aguardando_inicio", "em_tratamento", "finalizado"].includes(e.situation)
  ).length;
  const inNegotiation = approvedOnward.filter((e) =>
    ["aprovado", "fase_comercial"].includes(e.situation)
  ).length;

  const isPlannerOrAdmin =
    session.isAdminMaster ||
    Object.values(session.rolesByClinic).some((r) =>
      r.includes("planner_dentist")
    );

  const chipHref = (s: Situation | "") => {
    const p = new URLSearchParams();
    if (busca) p.set("busca", busca);
    if (unidade) p.set("unidade", unidade);
    if (s) p.set("situacao", s);
    const q = p.toString();
    return q ? `/planos?${q}` : "/planos";
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Planos de Tratamento
        </h1>
        <p className="text-sm text-muted-foreground">
          Central dos planos da {scopeIds && scopeIds.length === 1 ? "unidade" : "rede"}:
          acompanhe o que está em planejamento, aguardando aprovação, na fase
          comercial, aguardando iniciar, em tratamento e finalizado.
        </p>
      </div>

      {/* H3.15: aviso forte — casos comerciais sem apresentação agendada. */}
      {missingPresentationCount > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            <strong>{missingPresentationCount}</strong> caso(s) na fase comercial{" "}
            <strong>sem apresentação agendada</strong> — a recepção precisa
            agendar a apresentação comercial para o caso não travar.
          </span>
        </div>
      )}

      {/* Chips por situação (contadores clicáveis) */}
      <div className="flex flex-wrap gap-1.5">
        <Link
          href={chipHref("")}
          className={cn(
            "rounded-full border px-2.5 py-1 text-xs font-medium",
            !situacao
              ? "border-primary bg-primary text-primary-foreground"
              : "bg-background text-muted-foreground hover:border-primary"
          )}
        >
          Todos ({filtered.length})
        </Link>
        {SITUATIONS.map((s) => (
          <Link
            key={s}
            href={chipHref(s)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
              SITUATION_STYLES[s].chip,
              situacao === s && "ring-2 ring-primary/50"
            )}
          >
            <span
              className={cn("size-2 rounded-full", SITUATION_STYLES[s].dot)}
            />
            {SITUATION_LABELS[s]} ({counts[s]})
          </Link>
        ))}
      </div>

      <FilterForm className="flex flex-wrap items-center gap-2">
        {situacao && <input type="hidden" name="situacao" value={situacao} />}
        <Input
          name="busca"
          defaultValue={busca}
          placeholder="Buscar cliente pelo nome..."
          className="h-9 w-64"
        />
        {(units ?? []).length > 1 && (
          <select
            name="unidade"
            defaultValue={unidade}
            className="h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm"
          >
            <option value="">Todas as unidades</option>
            {(units ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        )}
      </FilterForm>

      {/* Lista */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {situacao ? SITUATION_LABELS[situacao] : "Todos os planos"} (
            {shown.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {shown.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhum plano de tratamento nesta situação.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 font-medium">Cliente</th>
                  <th className="px-2 py-1.5 font-medium">Unidade</th>
                  <th className="px-2 py-1.5 font-medium">Situação</th>
                  <th className="px-2 py-1.5 font-medium">Fase da Jornada</th>
                  <th className="px-2 py-1.5 font-medium">Criado</th>
                  <th className="px-2 py-1.5 font-medium">Última mudança</th>
                  <th className="px-2 py-1.5 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((e) => (
                  <tr key={e.planId} className="border-b last:border-0">
                    <td className="px-2 py-1.5">
                      <Link
                        href={`/prontuarios/${e.clientId}`}
                        className="font-medium hover:underline"
                      >
                        {e.clientName}
                      </Link>
                      {e.clientCode && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          {e.clientCode}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">{e.clinicName}</td>
                    <td className="px-2 py-1.5">
                      <Badge
                        variant="outline"
                        className={cn(
                          "gap-1 text-[11px]",
                          SITUATION_STYLES[e.situation].chip
                        )}
                      >
                        <span
                          className={cn(
                            "size-1.5 rounded-full",
                            SITUATION_STYLES[e.situation].dot
                          )}
                        />
                        {SITUATION_LABELS[e.situation]}
                      </Badge>
                      {missingPresentation(e.clientId, e.situation) && (
                        <Badge
                          variant="outline"
                          className="ml-1 gap-1 border-red-300 bg-red-50 text-[11px] text-red-700"
                        >
                          <AlertTriangle className="size-3" />
                          sem apresentação
                        </Badge>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-xs text-muted-foreground">
                      {PHASE_LABELS[e.phase]}
                      {e.jStatus ? ` · ${STATUS_LABELS[e.jStatus]}` : ""}
                    </td>
                    <td className="px-2 py-1.5 text-xs text-muted-foreground">
                      {fmtDate(e.createdAt)}
                    </td>
                    <td className="px-2 py-1.5 text-xs text-muted-foreground">
                      {fmtDate(e.lastAt)}
                    </td>
                    <td className="px-2 py-1.5 text-xs">
                      <Link
                        href={`/prontuarios/${e.clientId}`}
                        className="text-primary hover:underline"
                      >
                        Ficha
                      </Link>
                      {isPlannerOrAdmin && (
                        <>
                          {" · "}
                          <Link
                            href={`/planejamento/${e.clientId}`}
                            className="text-primary hover:underline"
                          >
                            Cockpit
                          </Link>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Relatório detalhado */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Relatório dos planos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div className="rounded-md border p-3">
              <p className="text-2xl font-semibold">{filtered.length}</p>
              <p className="text-xs text-muted-foreground">Planos no total</p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-2xl font-semibold">{approvedOnward.length}</p>
              <p className="text-xs text-muted-foreground">Aprovados</p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-2xl font-semibold">{reachedTreatment}</p>
              <p className="text-xs text-muted-foreground">
                Chegaram ao tratamento (Fase 5+)
              </p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-2xl font-semibold">{inNegotiation}</p>
              <p className="text-xs text-muted-foreground">
                Ainda em negociação (Fases 3–4)
              </p>
            </div>
          </div>

          {byUnit.size > 1 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1 font-medium">Unidade</th>
                    {SITUATIONS.map((s) => (
                      <th key={s} className="px-2 py-1 text-center font-medium">
                        {SITUATION_LABELS[s]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...byUnit.values()]
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((u, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="px-2 py-1 font-medium">{u.name}</td>
                        {SITUATIONS.map((s) => (
                          <td key={s} className="px-2 py-1 text-center">
                            {u.counts[s] ?? 0}
                          </td>
                        ))}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
