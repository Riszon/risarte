import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Info } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { resolveSla, type SlaSettingRow } from "@/lib/sla";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { FilterForm } from "@/components/filter-form";
import { PresentationCountdown } from "@/components/presentation-countdown";
import {
  METHODOLOGY_PILLARS,
  PILLAR_LABELS,
  formatTimeInPhase,
  isSlaExceeded,
  type JourneyPhase,
  type MethodologyPillar,
} from "@/lib/journey";
import { type TreatmentPlanStatus } from "@/lib/planning";

export const metadata: Metadata = { title: "Centro de Planejamento" };

type QueueClient = {
  id: string;
  full_name: string;
  code: string | null;
  status: "active" | "inactive" | "anonymized";
  clinic_id: string;
  journey_phase: JourneyPhase;
  methodology_pillar: MethodologyPillar | null;
  phase_entered_at: string;
  clinics: { name: string } | null;
};

// The situations the Planner follows in the Planning Center.
const SITUATIONS = [
  { key: "aguardando_planejamento", label: "Aguardando planejamento" },
  { key: "aguardando_aprovacao", label: "Aguardando aprovação" },
  { key: "em_revisao", label: "Em revisão" },
  { key: "aprovados", label: "Aprovados" },
  { key: "enviados_comercial", label: "Enviados ao Comercial" },
] as const;
type SituationKey = (typeof SITUATIONS)[number]["key"];

const SITUATION_LABELS = Object.fromEntries(
  SITUATIONS.map((s) => [s.key, s.label])
) as Record<SituationKey, string>;

const SITUATION_CLASS: Record<SituationKey, string> = {
  aguardando_planejamento: "bg-muted text-muted-foreground",
  aguardando_aprovacao: "bg-primary/10 text-primary",
  em_revisao: "bg-destructive/10 text-destructive",
  aprovados: "bg-emerald-100 text-emerald-800",
  enviados_comercial: "bg-gold text-gold-foreground",
};

function situationOf(
  phase: JourneyPhase,
  planStatus: TreatmentPlanStatus | undefined
): SituationKey {
  if (phase === "commercial_conversion") return "enviados_comercial";
  if (planStatus === "submitted") return "aguardando_aprovacao";
  if (planStatus === "returned") return "em_revisao";
  if (planStatus === "approved") return "aprovados";
  return "aguardando_planejamento";
}

/** Date range for the period filter (filters by phase_entered_at). */
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
    const diff = (s.getDay() + 6) % 7; // days since Monday
    s.setDate(s.getDate() - diff);
    s.setHours(0, 0, 0, 0);
    return { from: s.toISOString(), to: null };
  }
  if (periodo === "mes") {
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

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const selectClass =
  "h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm";

export default async function PlanningCenterPage(
  props: PageProps<"/planejamento">
) {
  const session = await getSessionContext();
  const isPlanner =
    session.isAdminMaster ||
    Object.values(session.rolesByClinic).some((roles) =>
      roles.includes("planner_dentist")
    );
  if (!isPlanner) redirect("/");

  const sp = await props.searchParams;
  const situacao = typeof sp.situacao === "string" ? sp.situacao : "";
  const periodo = typeof sp.periodo === "string" ? sp.periodo : "";
  const de = typeof sp.de === "string" ? sp.de : "";
  const ate = typeof sp.ate === "string" ? sp.ate : "";
  // H3.13: filtros por unidade e por pilar da metodologia.
  const unidade = typeof sp.unidade === "string" ? sp.unidade : "";
  const pilar = typeof sp.pilar === "string" ? sp.pilar : "";
  const range = periodRange(periodo, de, ate);

  const supabase = await createClient();

  // Cases in the Planning Center (Fase 3) and those already sent to the
  // Comercial (Fase 4). RLS limits to the units the Planner can see.
  let clientsQuery = supabase
    .from("clients")
    .select(
      "id, full_name, code, status, clinic_id, journey_phase, methodology_pillar, phase_entered_at, clinics!clients_clinic_id_fkey ( name )"
    )
    .in("journey_phase", ["planning_center", "commercial_conversion"])
    .neq("status", "anonymized")
    .limit(1000);
  if (range.from) clientsQuery = clientsQuery.gte("phase_entered_at", range.from);
  if (range.to) clientsQuery = clientsQuery.lte("phase_entered_at", range.to);
  if (unidade) clientsQuery = clientsQuery.eq("clinic_id", unidade);
  if (pilar) clientsQuery = clientsQuery.eq("methodology_pillar", pilar);

  const { data: clients } = await clientsQuery.returns<QueueClient[]>();
  const ids = (clients ?? []).map((c) => c.id);

  // H3.13: unidades para o filtro (RLS limita às visíveis pelo Planner).
  const { data: unitOptions } = await supabase
    .from("clinics")
    .select("id, name")
    .eq("type", "franchise_unit")
    .eq("is_active", true)
    .order("name");

  const nowIso = new Date().toISOString();
  const [{ data: presentations }, { data: planRows }, { data: slaRows }, { data: supRows }] =
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
      // H3.11: clientes com informação complementar ainda não vista pelo Planner.
      ids.length > 0
        ? supabase
            .from("planning_supplements")
            .select("client_id")
            .in("client_id", ids)
            .is("seen_at", null)
            .returns<{ client_id: string }[]>()
        : Promise.resolve({ data: [] as { client_id: string }[] }),
    ]);

  const presentationByClient = new Map<string, string>();
  for (const p of presentations ?? []) {
    if (!presentationByClient.has(p.client_id)) {
      presentationByClient.set(p.client_id, p.starts_at);
    }
  }
  const planByClient = new Map<string, TreatmentPlanStatus>();
  for (const p of planRows ?? []) {
    if (!planByClient.has(p.client_id)) planByClient.set(p.client_id, p.status);
  }
  const clientsWithNewInfo = new Set(
    (supRows ?? []).map((s) => s.client_id)
  );

  // Classify each case and count per situation.
  const counts: Record<SituationKey, number> = {
    aguardando_planejamento: 0,
    aguardando_aprovacao: 0,
    em_revisao: 0,
    aprovados: 0,
    enviados_comercial: 0,
  };
  const withSituation = (clients ?? []).map((c) => {
    const situation = situationOf(c.journey_phase, planByClient.get(c.id));
    counts[situation] += 1;
    return { client: c, situation };
  });

  const filtered = situacao
    ? withSituation.filter((x) => x.situation === situacao)
    : withSituation;

  // Priority: nearest scheduled commercial presentation; tiebreak = who entered
  // the phase first.
  const queue = [...filtered].sort((a, b) => {
    const pa = presentationByClient.get(a.client.id);
    const pb = presentationByClient.get(b.client.id);
    if (pa && pb && pa !== pb) return pa < pb ? -1 : 1;
    if (pa && !pb) return -1;
    if (!pa && pb) return 1;
    return a.client.phase_entered_at < b.client.phase_entered_at ? -1 : 1;
  });

  function hrefFor(key: string | null): string {
    const p = new URLSearchParams();
    if (key) p.set("situacao", key);
    if (periodo) p.set("periodo", periodo);
    if (de) p.set("de", de);
    if (ate) p.set("ate", ate);
    if (unidade) p.set("unidade", unidade);
    if (pilar) p.set("pilar", pilar);
    const qs = p.toString();
    return qs ? `/planejamento?${qs}` : "/planejamento";
  }

  const total = withSituation.length;

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Centro de Planejamento
        </h1>
        <p className="text-sm text-muted-foreground">
          Casos por situação, em ordem de prioridade (apresentação comercial mais
          próxima). Cartões com{" "}
          <span className="font-medium text-destructive">prazo estourado</span>{" "}
          (SLA de planejamento) aparecem destacados.
        </p>
      </div>

      {/* Situações (clicáveis) com contadores. */}
      <div className="flex flex-wrap gap-2">
        <Link
          href={hrefFor(null)}
          className={`rounded-full border px-3 py-1 text-sm ${
            situacao === "" ? "border-primary bg-primary/10 text-primary" : ""
          }`}
        >
          Todas ({total})
        </Link>
        {SITUATIONS.map((s) => (
          <Link
            key={s.key}
            href={hrefFor(s.key)}
            className={`rounded-full border px-3 py-1 text-sm ${
              situacao === s.key ? "border-primary bg-primary/10 text-primary" : ""
            }`}
          >
            {s.label} ({counts[s.key]})
          </Link>
        ))}
      </div>

      {/* Filtro de período. */}
      <FilterForm className="flex flex-wrap items-center gap-2">
        {situacao && <input type="hidden" name="situacao" value={situacao} />}
        <label className="text-sm text-muted-foreground">Período:</label>
        <select name="periodo" defaultValue={periodo} className={selectClass}>
          <option value="">Tudo</option>
          <option value="dia">Hoje</option>
          <option value="semana">Esta semana</option>
          <option value="mes">Este mês</option>
          <option value="periodo">Período específico</option>
        </select>
        {periodo === "periodo" && (
          <>
            <Input type="date" name="de" defaultValue={de} className="w-auto" />
            <span className="text-sm text-muted-foreground">até</span>
            <Input type="date" name="ate" defaultValue={ate} className="w-auto" />
          </>
        )}
        {(unitOptions ?? []).length > 1 && (
          <select name="unidade" defaultValue={unidade} className={selectClass}>
            <option value="">Todas as unidades</option>
            {(unitOptions ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        )}
        <select name="pilar" defaultValue={pilar} className={selectClass}>
          <option value="">Todos os pilares</option>
          {METHODOLOGY_PILLARS.map((p) => (
            <option key={p} value={p}>
              {PILLAR_LABELS[p]}
            </option>
          ))}
        </select>
      </FilterForm>

      {queue.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nenhum caso nesta situação/período.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Cliente</th>
                <th className="px-3 py-2 font-medium">Unidade</th>
                <th className="px-3 py-2 font-medium">Situação</th>
                <th className="px-3 py-2 font-medium">Apresentação</th>
                <th className="px-3 py-2 font-medium">Tempo na fase</th>
              </tr>
            </thead>
            <tbody>
              {queue.map(({ client: c, situation }, index) => {
                const sla = resolveSla(slaRows ?? [], c.clinic_id);
                const overdue =
                  c.journey_phase === "planning_center" &&
                  isSlaExceeded(c.phase_entered_at, sla.planning);
                const presentation = presentationByClient.get(c.id);
                return (
                  <tr
                    key={c.id}
                    className={overdue ? "border-b bg-destructive/5" : "border-b"}
                  >
                    <td className="px-3 py-2 text-muted-foreground">
                      {index + 1}
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-1.5">
                        <Link
                          href={`/planejamento/${c.id}`}
                          className="font-medium hover:underline"
                        >
                          {c.full_name}
                        </Link>
                        {clientsWithNewInfo.has(c.id) && (
                          <span
                            className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                            title="Chegou informação complementar do Coordenador"
                          >
                            <Info className="size-3" />
                            nova info
                          </span>
                        )}
                      </span>
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
                        <span className="text-xs text-muted-foreground">
                          {c.methodology_pillar
                            ? PILLAR_LABELS[c.methodology_pillar]
                            : "Pilar a definir"}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2">{c.clinics?.name ?? "—"}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs ${SITUATION_CLASS[situation]}`}
                      >
                        {SITUATION_LABELS[situation]}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {presentation ? (
                        <span className="flex flex-col items-start gap-1">
                          <span>{fmtDate(presentation)}</span>
                          {/* AJ3: cronômetro; alarme quando o plano ainda não
                              está pronto (não aprovado / não enviado). */}
                          <PresentationCountdown
                            startsAt={presentation}
                            alarm={
                              situation !== "aprovados" &&
                              situation !== "enviados_comercial"
                            }
                          />
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Não agendada
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={overdue ? "font-medium text-destructive" : ""}
                      >
                        {formatTimeInPhase(c.phase_entered_at)}
                      </span>
                      {overdue && (
                        <Badge
                          variant="destructive"
                          className="ml-2 text-[10px]"
                        >
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
