import type { Metadata } from "next";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  AppointmentStatus,
  AppointmentType,
  AttendanceStatus,
} from "@/lib/appointments";
import type { JourneyPhase } from "@/lib/journey";
import { AttendancePanel, type PanelAppointment } from "./attendance-panel";

export const metadata: Metadata = { title: "Atendimento" };

type Row = {
  id: string;
  type: AppointmentType;
  status: AppointmentStatus;
  starts_at: string;
  attendance: AttendanceStatus | null;
  checked_in_at: string | null;
  provider: { full_name: string } | null;
  clients: { id: string; full_name: string; journey_phase: JourneyPhase } | null;
};

export default async function AtendimentoPage() {
  const session = await getSessionContext();
  const clinicId = session.activeClinic?.id;
  const isUnit = session.activeClinic?.type === "franchise_unit";

  if (!clinicId || !isUnit) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">Atendimento</h1>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Selecione uma unidade
            </CardTitle>
            <CardDescription>
              O painel de atendimento (sala de espera) é por unidade. Use o
              seletor no menu lateral para entrar em uma unidade.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const supabase = await createClient();
  const { data } = await supabase
    .from("appointments")
    .select(
      "id, type, status, starts_at, attendance, checked_in_at, provider:profiles!appointments_provider_user_id_fkey ( full_name ), clients ( id, full_name, journey_phase )"
    )
    .eq("clinic_id", clinicId)
    .gte("starts_at", start.toISOString())
    .lt("starts_at", end.toISOString())
    .order("starts_at")
    .returns<Row[]>();

  const appointments: PanelAppointment[] = (data ?? []).map((a) => ({
    id: a.id,
    type: a.type,
    status: a.status,
    starts_at: a.starts_at,
    attendance: a.attendance,
    clientId: a.clients?.id ?? null,
    clientName: a.clients?.full_name ?? "—",
    providerName: a.provider?.full_name ?? null,
  }));

  const canCheckIn = hasRoleInClinic(session, clinicId, [
    "receptionist",
    "sdr",
  ]);
  const canCall = hasRoleInClinic(session, clinicId, [
    "receptionist",
    "clinical_coordinator",
    "dentist",
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Atendimento</h1>
        <p className="text-sm text-muted-foreground">
          Sala de espera de {session.activeClinic?.name} —{" "}
          {start.toLocaleDateString("pt-BR")}.
        </p>
      </div>
      <AttendancePanel
        appointments={appointments}
        canCheckIn={canCheckIn}
        canCall={canCall}
      />
    </div>
  );
}
