import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { resolveSla, type SlaSettingRow } from "@/lib/sla";
import { Badge } from "@/components/ui/badge";
import {
  PILLAR_LABELS,
  STATUS_LABELS,
  formatTimeInPhase,
  isSlaExceeded,
  type JourneyStatus,
  type MethodologyPillar,
} from "@/lib/journey";
import { PLAN_STATUS_LABELS, type TreatmentPlanStatus } from "@/lib/planning";

export const metadata: Metadata = { title: "Centro de Planejamento" };

type QueueClient = {
  id: string;
  full_name: string;
  code: string | null;
  status: "active" | "inactive" | "anonymized";
  clinic_id: string;
  journey_status: JourneyStatus | null;
  methodology_pillar: MethodologyPillar | null;
  phase_entered_at: string;
  clinics: { name: string } | null;
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function PlanningCenterPage() {
  const session = await getSessionContext();

  const isPlanner =
    session.isAdminMaster ||
    Object.values(session.rolesByClinic).some((roles) =>
      roles.includes("planner_dentist")
    );
  // Only the Dentista Planner (and Admin) work the Planning Center queue.
  if (!isPlanner) redirect("/");

  const supabase = await createClient();

  // Clients in the Planning Center (Fase 3) the viewer is allowed to see (RLS).
  const { data: clients } = await supabase
    .from("clients")
    .select(
      "id, full_name, code, status, clinic_id, journey_status, methodology_pillar, phase_entered_at, clinics!clients_clinic_id_fkey ( name )"
    )
    .eq("journey_phase", "planning_center")
    .neq("status", "anonymized")
    .limit(1000)
    .returns<QueueClient[]>();

  const ids = (clients ?? []).map((c) => c.id);

  const nowIso = new Date().toISOString();
  const [{ data: presentations }, { data: planRows }, { data: slaRows }] =
    await Promise.all([
      ids.length > 0
        ? supabase
            .from("appointments")
            .select("client_id, starts_at")
            .in("client_id", ids)
            .eq("type", "commercial_presentation")
            .in("status", ["scheduled", "confirmed"])
            .gte("starts_at", nowIso)
            .order("starts_at")
            .returns<{ client_id: string; starts_at: string }[]>()
        : Promise.resolve({ data: [] as { client_id: string; starts_at: string }[] }),
      ids.length > 0
        ? supabase
            .from("treatment_plans")
            .select("client_id, status, created_at")
            .in("client_id", ids)
            .order("created_at", { ascending: false })
            .returns<
              { client_id: string; status: TreatmentPlanStatus; created_at: string }[]
            >()
        : Promise.resolve({
            data: [] as {
              client_id: string;
              status: TreatmentPlanStatus;
              created_at: string;
            }[],
          }),
      supabase
        .from("sla_settings")
        .select("id, clinic_id, sla_key, hours")
        .returns<SlaSettingRow[]>(),
    ]);

  // Earliest upcoming commercial presentation per client (rows already sorted).
  const presentationByClient = new Map<string, string>();
  for (const p of presentations ?? []) {
    if (!presentationByClient.has(p.client_id)) {
      presentationByClient.set(p.client_id, p.starts_at);
    }
  }
  // Latest plan status per client (rows already sorted desc).
  const planByClient = new Map<string, TreatmentPlanStatus>();
  for (const p of planRows ?? []) {
    if (!planByClient.has(p.client_id)) planByClient.set(p.client_id, p.status);
  }

  // Priority: nearest scheduled commercial presentation; tiebreak = who entered
  // the Planning Center first.
  const queue = [...(clients ?? [])].sort((a, b) => {
    const pa = presentationByClient.get(a.id);
    const pb = presentationByClient.get(b.id);
    if (pa && pb && pa !== pb) return pa < pb ? -1 : 1;
    if (pa && !pb) return -1;
    if (!pa && pb) return 1;
    return a.phase_entered_at < b.phase_entered_at ? -1 : 1;
  });

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Centro de Planejamento
        </h1>
        <p className="text-sm text-muted-foreground">
          {queue.length} caso(s) na Fase 3, em ordem de prioridade — primeiro os
          de apresentação comercial mais próxima. Cartões com{" "}
          <span className="font-medium text-destructive">prazo estourado</span>{" "}
          (SLA de planejamento) aparecem destacados.
        </p>
      </div>

      {queue.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nenhum caso aguardando planejamento no momento.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Cliente</th>
                <th className="px-3 py-2 font-medium">Unidade</th>
                <th className="px-3 py-2 font-medium">Plano</th>
                <th className="px-3 py-2 font-medium">Apresentação</th>
                <th className="px-3 py-2 font-medium">Tempo na fase</th>
              </tr>
            </thead>
            <tbody>
              {queue.map((c, index) => {
                const sla = resolveSla(slaRows ?? [], c.clinic_id);
                const overdue = isSlaExceeded(c.phase_entered_at, sla.planning);
                const presentation = presentationByClient.get(c.id);
                const planStatus = planByClient.get(c.id);
                return (
                  <tr
                    key={c.id}
                    className={
                      overdue ? "border-b bg-destructive/5" : "border-b"
                    }
                  >
                    <td className="px-3 py-2 text-muted-foreground">
                      {index + 1}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/clientes/${c.id}`}
                        className="font-medium hover:underline"
                      >
                        {c.full_name}
                      </Link>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {c.code && (
                          <span className="font-mono text-xs text-gold">
                            {c.code}
                          </span>
                        )}
                        {c.status !== "active" && (
                          <Badge variant="outline" className="text-[10px]">
                            Inativo
                          </Badge>
                        )}
                        {c.methodology_pillar ? (
                          <span className="text-xs text-muted-foreground">
                            {PILLAR_LABELS[c.methodology_pillar]}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            Pilar a definir
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">{c.clinics?.name ?? "—"}</td>
                    <td className="px-3 py-2">
                      {planStatus ? (
                        <Badge
                          variant={
                            planStatus === "approved" ? "secondary" : "outline"
                          }
                        >
                          {PLAN_STATUS_LABELS[planStatus]}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Sem plano
                        </span>
                      )}
                      {c.journey_status && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {STATUS_LABELS[c.journey_status]}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {presentation ? (
                        fmtDate(presentation)
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Não agendada
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className={overdue ? "font-medium text-destructive" : ""}>
                        {formatTimeInPhase(c.phase_entered_at)}
                      </span>
                      {overdue && (
                        <Badge variant="destructive" className="ml-2 text-[10px]">
                          SLA
                        </Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
