import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  APPOINTMENT_TYPE_LABELS,
  type AppointmentStatus,
  type AppointmentType,
} from "@/lib/appointments";
import { PHASE_LABELS, type JourneyPhase } from "@/lib/journey";

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

export default async function ReturnsPage() {
  const session = await getSessionContext();
  const clinic = session.activeClinic;

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
  if (ids.length > 0) {
    const { data: apptRows } = await supabase
      .from("appointments")
      .select("client_id, starts_at, status")
      .eq("clinic_id", clinic.id)
      .in("client_id", ids)
      .order("starts_at", { ascending: false });
    for (const a of apptRows ?? []) {
      const active = a.status !== "cancelled" && a.status !== "no_show";
      if (active && a.starts_at >= nowIso) scheduledSet.add(a.client_id);
      if (
        a.starts_at < nowIso &&
        active &&
        !lastVisitByClient.has(a.client_id)
      ) {
        lastVisitByClient.set(a.client_id, a.starts_at);
      }
    }
  }
  const pending = (candidates ?? []).filter((c) => !scheduledSet.has(c.id));

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
        <CardHeader>
          <CardTitle className="text-base">
            A lembrar de reagendar{" "}
            <span className="font-normal text-muted-foreground">
              ({pending.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum cliente pendente de retorno no momento.
            </p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {pending.map((c) => {
                const last = lastVisitByClient.get(c.id);
                return (
                  <li
                    key={c.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                  >
                    <div>
                      <Link
                        href={`/clientes/${c.id}`}
                        className="font-medium hover:underline"
                      >
                        {c.full_name}
                      </Link>
                      <span className="text-muted-foreground">
                        {" "}
                        · {PHASE_LABELS[c.journey_phase]}
                        {last ? ` · última visita ${fmtDate(last)}` : ""}
                      </span>
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
