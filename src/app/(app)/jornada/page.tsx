import type { Metadata } from "next";
import Link from "next/link";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { resolveSla, type SlaSettingRow } from "@/lib/sla";
import { Button } from "@/components/ui/button";
import type { JourneyPhase, MethodologyPillar } from "@/lib/journey";
import { KanbanBoard, type KanbanClient } from "./kanban-board";

export const metadata: Metadata = { title: "Jornada do Cliente" };

type ClientRow = {
  id: string;
  full_name: string;
  journey_phase: JourneyPhase;
  phase_entered_at: string;
  methodology_pillar: MethodologyPillar | null;
};

export default async function JourneyPage() {
  const session = await getSessionContext();
  const clinicId = session.activeClinic?.id;

  if (!clinicId) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Jornada do Cliente
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Selecione uma clínica no menu lateral.
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: clients }, { data: slaRows }] = await Promise.all([
    supabase
      .from("clients")
      .select(
        "id, full_name, journey_phase, phase_entered_at, methodology_pillar"
      )
      .eq("clinic_id", clinicId)
      .eq("status", "active")
      .order("phase_entered_at")
      .limit(500)
      .returns<ClientRow[]>(),
    supabase
      .from("sla_settings")
      .select("id, clinic_id, sla_key, hours")
      .returns<SlaSettingRow[]>(),
  ]);

  const sla = resolveSla(slaRows ?? [], clinicId);
  const clinicRoles = session.rolesByClinic[clinicId] ?? [];
  const isPlannerAnywhere = Object.values(session.rolesByClinic).some((roles) =>
    roles.includes("planner_dentist")
  );
  const canRegister = hasRoleInClinic(session, clinicId, ["receptionist"]);
  const isFranchisor = session.activeClinic?.type === "franchisor";

  return (
    <div className="space-y-4 px-4 py-8">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Jornada do Cliente
          </h1>
          <p className="text-sm text-muted-foreground">
            {session.activeClinic?.name} — clientes ativos por fase. Cartões com{" "}
            <span className="font-medium text-destructive">borda vermelha</span>{" "}
            estouraram o prazo (SLA).
          </p>
        </div>
        <div className="flex gap-2">
          {canRegister && !isFranchisor && (
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href="/clientes/novo" />}
            >
              Cadastrar cliente
            </Button>
          )}
          <Button
            size="sm"
            nativeButton={false}
            render={<Link href="/agenda" />}
          >
            Ir para a agenda
          </Button>
        </div>
      </div>
      <div className="mx-auto max-w-7xl overflow-x-auto pb-4">
        <KanbanBoard
          clients={(clients ?? []) as KanbanClient[]}
          sla={sla}
          isAdminMaster={session.isAdminMaster}
          clinicRoles={clinicRoles}
          isPlannerAnywhere={isPlannerAnywhere}
        />
      </div>
    </div>
  );
}
