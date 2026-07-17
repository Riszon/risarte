import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  getSessionContext,
  hasRoleInClinic,
  isSdrRestricted,
  sdrAccessibleClientIds,
} from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { resolveSla, type SlaSettingRow } from "@/lib/sla";
import { Button } from "@/components/ui/button";
import { FilterForm } from "@/components/filter-form";
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
  status: "active" | "inactive" | "anonymized";
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

  // The Dentista (executor) does not have the Jornada screen (owner rule).
  const activeRoles = session.rolesByClinic[clinicId] ?? [];
  if (
    !session.isAdminMaster &&
    activeRoles.length > 0 &&
    activeRoles.every((r) => r === "dentist")
  ) {
    redirect("/");
  }

  const unitFilter =
    typeof searchParams.unidade === "string" ? searchParams.unidade : "";
  const pillarFilter =
    typeof searchParams.pilar === "string" ? searchParams.pilar : "";
  const statusFilter =
    typeof searchParams.status === "string" ? searchParams.status : "";

  const supabase = await createClient();

  const baseSelect =
    "id, full_name, status, journey_phase, journey_status, phase_entered_at, methodology_pillar, clinic_id, clinics!clients_clinic_id_fkey ( name )";

  let clientsQuery = supabase
    .from("clients")
    .select(baseSelect)
    .order("phase_entered_at")
    .limit(1000);

  // Inactive clients appear too (marked); default shows active + inactive.
  if (statusFilter === "active" || statusFilter === "inactive") {
    clientsQuery = clientsQuery.eq("status", statusFilter);
  } else {
    clientsQuery = clientsQuery.neq("status", "anonymized");
  }

  if (isFranchisor) {
    // Network view: all units; planner/admin/franchisor see the whole rede.
    if (unitFilter) clientsQuery = clientsQuery.eq("clinic_id", unitFilter);
  } else {
    clientsQuery = clientsQuery.eq("clinic_id", clinicId);
  }
  if (pillarFilter) {
    clientsQuery = clientsQuery.eq("methodology_pillar", pillarFilter);
  }

  // H3.7: a SDR "pura" vê na Jornada só os clientes que ela tocou (mesmo
  // conjunto de Prontuários), não a rede toda.
  if (isSdrRestricted(session)) {
    const ids = await sdrAccessibleClientIds();
    clientsQuery = clientsQuery.in(
      "id",
      ids.length > 0 ? ids : ["00000000-0000-0000-0000-000000000000"]
    );
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
                Visão da rede — {phaseCounts} cliente(s)
                {unitFilter ? " na unidade selecionada" : " em todas as unidades"}
                .
              </>
            ) : (
              <>
                {session.activeClinic?.name} — {phaseCounts} cliente(s) por fase.
                Cartões com{" "}
                <span className="font-medium text-destructive">
                  borda vermelha
                </span>{" "}
                estouraram o prazo (SLA).
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FilterForm className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2">
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
            <select
              name="status"
              defaultValue={statusFilter}
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
            >
              <option value="">Ativos e inativos</option>
              <option value="active">Somente ativos</option>
              <option value="inactive">Somente inativos</option>
            </select>
          </FilterForm>
          {canRegister && !isFranchisor && (
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href="/prontuarios/novo" />}
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
      <div className="mx-auto h-[calc(100vh-13rem)] min-h-[24rem] max-w-7xl overflow-x-auto pb-2">
        <KanbanBoard
          clients={(clients ?? []).map((c) => ({
            id: c.id,
            full_name: c.full_name,
            status: c.status,
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
