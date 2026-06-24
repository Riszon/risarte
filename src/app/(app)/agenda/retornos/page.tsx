import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AlertTriangle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  APPOINTMENT_TYPE_LABELS,
  type AppointmentStatus,
  type AppointmentType,
} from "@/lib/appointments";
import { PHASE_LABELS, type JourneyPhase } from "@/lib/journey";
import {
  resolveInactivity,
  type InactivitySettingRow,
} from "@/lib/sla";
import { FilterForm } from "@/components/filter-form";

export const metadata: Metadata = { title: "Retornos e controles" };

// Returns (Retorno) and controls (Reavaliação) — the periodic visits the
// reception must keep track of.
const RETURN_TYPES: AppointmentType[] = ["return_visit", "reevaluation"];
// Clients in these phases are expected to come back periodically.
const RETURN_PHASES: JourneyPhase[] = ["follow_up", "reevaluation"];

type UpcomingRow = {
  id: string;
  type: AppointmentType;
  status: AppointmentStatus;
  starts_at: string;
  provider: { full_name: string } | null;
  room: { name: string } | null;
  clients: { id: string; full_name: string } | null;
};

export default async function ReturnsPage(
  props: PageProps<"/agenda/retornos">
) {
  const session = await getSessionContext();
  const clinic = session.activeClinic;
  const sp = await props.searchParams;
  const order = sp.ordem === "asc" ? "asc" : "desc"; // default: longest first

  if (!clinic || clinic.type === "franchisor") {
    return (
      <div className="mx-auto max-w-3xl space-y-3 px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Retornos e controles
        </h1>
        <p className="text-sm text-muted-foreground">
          Selecione uma unidade no menu lateral.
        </p>
      </div>
    );
  }

  const canManage = hasRoleInClinic(session, clinic.id, [
    "receptionist",
    "unit_manager",
  ]);
  if (!canManage) redirect("/agenda");

  const supabase = await createClient();
  const nowIso = new Date().toISOString();

  // 1) Scheduled returns/controls (future, still active).
  const { data: upcoming } = await supabase
    .from("appointments")
    .select(
      "id, type, status, starts_at, provider:profiles!appointments_provider_user_id_fkey ( full_name ), room:clinic_rooms ( name ), clients ( id, full_name )"
    )
    .eq("clinic_id", clinic.id)
    .in("type", RETURN_TYPES)
    .gte("starts_at", nowIso)
    .order("starts_at")
    .limit(200)
    .returns<UpcomingRow[]>();
  const scheduled = (upcoming ?? []).filter(
    (a) => a.status !== "cancelled" && a.status !== "no_show"
  );

  // 2) Clients due to return that have no future appointment (pre-scheduled).
  const { data: candidates } = await supabase
    .from("clients")
    .select("id, full_name, journey_phase, journey_status")
    .eq("clinic_id", clinic.id)
    .in("journey_phase", RETURN_PHASES)
    .neq("status", "anonymized")
    .order("full_name")
    .limit(300)
    .returns<
      {
        id: string;
        full_name: string;
        journey_phase: JourneyPhase;
        journey_status: string | null;
      }[]
    >();

  const ids = (candidates ?? []).map((c) => c.id);
  const scheduledSet = new Set<string>();
  const lastVisitByClient = new Map<string, string>();
  const lastProviderByClient = new Map<string, string>();

  const { data: inactivityRows } = await supabase
    .from("inactivity_settings")
    .select("id, clinic_id, setting_key, value_days")
    .returns<InactivitySettingRow[]>();
  const inactivity = resolveInactivity(inactivityRows ?? [], clinic.id);

  if (ids.length > 0) {
    const { data: apptRows } = await supabase
      .from("appointments")
      .select(
        "client_id, starts_at, status, provider:profiles!appointments_provider_user_id_fkey ( full_name )"
      )
      .eq("clinic_id", clinic.id)
      .in("client_id", ids)
      .order("starts_at", { ascending: false });
    for (const a of (apptRows ?? []) as unknown as {
      client_id: string;
      starts_at: string;
      status: string;
      provider: { full_name: string } | null;
    }[]) {
      const isActive = a.status !== "cancelled" && a.status !== "no_show";
      if (isActive && a.starts_at >= nowIso) scheduledSet.add(a.client_id);
      if (
        a.starts_at < nowIso &&
        isActive &&
        !lastVisitByClient.has(a.client_id)
      ) {
        lastVisitByClient.set(a.client_id, a.starts_at);
        if (a.provider?.full_name) {
          lastProviderByClient.set(a.client_id, a.provider.full_name);
        }
      }
    }
  }

  const nowMs = new Date(nowIso).getTime();
  function thresholdFor(phase: JourneyPhase): number | null {
    if (phase === "reevaluation")
      return inactivity.phase5_6_no_appt_days ?? inactivity.no_attendance_days;
    if (phase === "follow_up")
      return inactivity.phase7_inactivity_days ?? inactivity.no_attendance_days;
    return inactivity.no_attendance_days;
  }
  type Severity = "ok" | "warn" | "alert" | "unknown";
  type PendingItem = {
    id: string;
    full_name: string;
    journey_phase: JourneyPhase;
    daysSince: number | null;
    threshold: number | null;
    severity: Severity;
    lastVisit: string | null;
    lastProvider: string | null;
  };
  const pendingItems: PendingItem[] = (candidates ?? [])
    .filter((c) => !scheduledSet.has(c.id))
    .map((c) => {
      const last = lastVisitByClient.get(c.id) ?? null;
      const daysSince = last
        ? Math.floor((nowMs - new Date(last).getTime()) / 86_400_000)
        : null;
      const threshold = thresholdFor(c.journey_phase);
      let severity: Severity = "unknown";
      if (daysSince !== null) {
        if (threshold && threshold > 0) {
          const ratio = daysSince / threshold;
          severity = ratio >= 0.8 ? "alert" : ratio >= 0.5 ? "warn" : "ok";
        } else {
          severity = "ok";
        }
      }
      return {
        id: c.id,
        full_name: c.full_name,
        journey_phase: c.journey_phase,
        daysSince,
        threshold,
        severity,
        lastVisit: last,
        lastProvider: lastProviderByClient.get(c.id) ?? null,
      };
    });
  // Default priority: longest without attendance first (no visit = most urgent).
  const rank = (it: PendingItem) =>
    it.daysSince === null ? Number.POSITIVE_INFINITY : it.daysSince;
  pendingItems.sort((a, b) =>
    order === "asc" ? rank(a) - rank(b) : rank(b) - rank(a)
  );

  const fmtDateTime = (iso: string) =>
    new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-8">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Retornos e controles
          </h1>
          <p className="text-sm text-muted-foreground">
            {clinic.name} — visitas periódicas (retornos e controles) já marcadas
            e clientes a lembrar de reagendar.
          </p>
        </div>
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/agenda" />}>
          Voltar à agenda
        </Button>
      </div>

      {/* Agendados ------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Agendados{" "}
            <span className="font-normal text-muted-foreground">
              ({scheduled.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {scheduled.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum retorno ou controle agendado.
            </p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {scheduled.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                >
                  <div>
                    {a.clients ? (
                      <Link
                        href={`/clientes/${a.clients.id}`}
                        className="font-medium hover:underline"
                      >
                        {a.clients.full_name}
                      </Link>
                    ) : (
                      <span className="font-medium">—</span>
                    )}
                    <span className="text-muted-foreground">
                      {" "}
                      · {fmtDateTime(a.starts_at)}
                      {a.room?.name ? ` · ${a.room.name}` : ""}
                      {a.provider?.full_name ? ` · ${a.provider.full_name}` : ""}
                    </span>
                  </div>
                  <Badge variant="secondary" className="text-[11px]">
                    {APPOINTMENT_TYPE_LABELS[a.type]}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* A reagendar (pré-agendados) ------------------------------------- */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">
            A lembrar de reagendar{" "}
            <span className="font-normal text-muted-foreground">
              ({pendingItems.length})
            </span>
          </CardTitle>
          <FilterForm className="flex items-center gap-1.5 text-xs">
            <label htmlFor="ordem" className="text-muted-foreground">
              Ordem:
            </label>
            <select
              id="ordem"
              name="ordem"
              defaultValue={order}
              className="h-8 rounded-lg border border-input bg-transparent px-2 text-xs"
            >
              <option value="desc">Maior tempo sem atendimento primeiro</option>
              <option value="asc">Menor tempo primeiro</option>
            </select>
          </FilterForm>
        </CardHeader>
        <CardContent>
          {pendingItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum cliente pendente de retorno no momento.
            </p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {pendingItems.map((c) => {
                const tone =
                  c.severity === "alert"
                    ? "text-red-700"
                    : c.severity === "warn"
                      ? "text-amber-700"
                      : "text-muted-foreground";
                const timeLabel =
                  c.daysSince === null
                    ? "sem visita registrada"
                    : `${c.daysSince} dia${c.daysSince === 1 ? "" : "s"} sem atendimento`;
                return (
                  <li
                    key={c.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        {c.severity === "alert" && (
                          <AlertTriangle className="size-3.5 shrink-0 text-red-600" />
                        )}
                        {c.severity === "warn" && (
                          <Clock className="size-3.5 shrink-0 text-amber-600" />
                        )}
                        <Link
                          href={`/clientes/${c.id}`}
                          className="font-medium hover:underline"
                        >
                          {c.full_name}
                        </Link>
                        <span className={`text-xs font-medium ${tone}`}>
                          · {timeLabel}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {PHASE_LABELS[c.journey_phase]}
                        {c.lastVisit ? ` · última visita ${fmtDate(c.lastVisit)}` : ""}
                        {c.lastProvider ? ` · atendeu: ${c.lastProvider}` : ""}
                        {c.severity === "alert" && c.threshold
                          ? ` · próximo da inatividade (${c.threshold}d)`
                          : ""}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      nativeButton={false}
                      render={<Link href={`/agenda?cliente=${c.id}`} />}
                    >
                      Agendar
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
