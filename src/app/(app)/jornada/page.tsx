import type { Metadata } from "next";
import Link from "next/link";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { resolveSla, type SlaSettingRow } from "@/lib/sla";
import { Button } from "@/components/ui/button";
import {
  TREATMENT_PILLARS,
  PILLAR_LABELS,
  type JourneyPhase,
  type JourneyStatus,
  type MethodologyPillar,
} from "@/lib/journey";
import { KanbanBoard, type KanbanClient } from "./kanban-board";

export const metadata: Metadata = { title: "Jornada do Cliente" };

type ClientRow = {
  id: string;
  full_name: string;
  journey_phase: JourneyPhase;
  journey_status: JourneyStatus | null;
  phase_entered_at: string;
  methodology_pillar: MethodologyPillar | null;
  clinic_id: string;
  clinics: { name: string } | null;
};

export default async function JourneyPage(props: PageProps<"/jornada">) {
  const session = await getSessionContext();
  const searchParams = await props.searchParams;
  const clinicId = session.activeClinic?.id;
  const isFranchisor = session.activeClinic?.type === "franchisor";

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

  const unitFilter =
    typeof searchParams.unidade === "string" ? searchParams.unidade : "";
  const pillarFilter =
    typeof searchParams.pilar === "string" ? searchParams.pilar : "";

  const supabase = await createClient();

  const baseSelect =
    "id, full_name, journey_phase, journey_status, phase_entered_at, methodology_pillar, clinic_id, clinics!clients_clinic_id_fkey ( name )";

  let clientsQuery = supabase
    .from("clients")
    .select(baseSelect)
    .eq("status", "active")
    .order("phase_entered_at")
    .limit(1000);

  if (isFranchisor) {
    // Network view: all units; planner/admin/franchisor see the whole rede.
    if (unitFilter) clientsQuery = clientsQuery.eq("clinic_id", unitFilter);
  } else {
    clientsQuery = clientsQuery.eq("clinic_id", clinicId);
  }
  if (pillarFilter) {
    clientsQuery = clientsQuery.eq("methodology_pillar", pillarFilter);
  }

  const [{ data: clients }, { data: slaRows }, { data: unitOptions }] =
    await Promise.all([
      clientsQuery.returns<ClientRow[]>(),
      supabase
        .from("sla_settings")
        .select("id, clinic_id, sla_key, hours")
        .returns<SlaSettingRow[]>(),
      isFranchisor
        ? supabase
            .from("clinics")
            .select("id, name")
            .eq("type", "franchise_unit")
            .eq("is_active", true)
            .order("name")
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    ]);

  // In the network view use the unit's SLA when filtered, else network default.
  const slaClinicId = isFranchisor ? unitFilter || null : clinicId;
  const sla = resolveSla(slaRows ?? [], slaClinicId);

  const clinicRoles = session.rolesByClinic[clinicId] ?? [];
  const isPlannerAnywhere = Object.values(session.rolesByClinic).some((roles) =>
    roles.includes("planner_dentist")
  );
  const canRegister = hasRoleInClinic(session, clinicId, [
    "receptionist",
    "sdr",
  ]);

  const phaseCounts = (clients ?? []).length;

  return (
    <div className="space-y-4 px-4 py-8">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Jornada do Cliente
          </h1>
          <p className="text-sm text-muted-foreground">
            {isFranchisor ? (
              <>
                Visão da rede — {phaseCounts} cliente(s) ativo(s)
                {unitFilter ? " na unidade selecionada" : " em todas as unidades"}
                .
              </>
            ) : (
              <>
                {session.activeClinic?.name} — clientes ativos por fase. Cartões
                com{" "}
                <span className="font-medium text-destructive">
                  borda vermelha
                </span>{" "}
                estouraram o prazo (SLA).
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <form method="get" className="flex items-center gap-2">
            {isFranchisor && (
              <select
                name="unidade"
                defaultValue={unitFilter}
                className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
              >
                <option value="">Todas as unidades</option>
                {(unitOptions ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            )}
            <select
              name="pilar"
              defaultValue={pillarFilter}
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
            >
              <option value="">Pilar de tratamento (todos)</option>
              {TREATMENT_PILLARS.map((pillar) => (
                <option key={pillar} value={pillar}>
                  {PILLAR_LABELS[pillar]}
                </option>
              ))}
            </select>
            <Button type="submit" variant="outline" size="sm">
              Filtrar
            </Button>
          </form>
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
          {!isFranchisor && (
            <Button
              size="sm"
              nativeButton={false}
              render={<Link href="/agenda" />}
            >
              Ir para a agenda
            </Button>
          )}
        </div>
      </div>
      <div className="mx-auto max-w-7xl overflow-x-auto pb-4">
        <KanbanBoard
          clients={(clients ?? []).map((c) => ({
            id: c.id,
            full_name: c.full_name,
            journey_phase: c.journey_phase,
            journey_status: c.journey_status,
            phase_entered_at: c.phase_entered_at,
            methodology_pillar: c.methodology_pillar,
            clinic_name: isFranchisor ? (c.clinics?.name ?? null) : null,
          })) as KanbanClient[]}
          sla={sla}
          isAdminMaster={session.isAdminMaster}
          clinicRoles={clinicRoles}
          isPlannerAnywhere={isPlannerAnywhere}
          canRegister={canRegister && !isFranchisor}
        />
      </div>
    </div>
  );
}
