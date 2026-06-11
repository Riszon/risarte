import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ClientForm } from "../client-form";
import {
  JourneySection,
  type ClientAppointment,
  type HistoryEntry,
} from "./journey-section";
import type { JourneyPhase, MethodologyPillar } from "@/lib/journey";

export const metadata: Metadata = { title: "Ficha do cliente" };

type HistoryRow = {
  id: string;
  phase: JourneyPhase;
  entered_at: string;
  exited_at: string | null;
  profiles: { full_name: string } | null;
};

const STATUS_LABELS = {
  active: "Ativo",
  inactive: "Inativo",
  anonymized: "Anonimizado",
} as const;

export default async function ClientDetailPage(
  props: PageProps<"/clientes/[id]">
) {
  const session = await getSessionContext();
  const { id } = await props.params;
  const supabase = await createClient();

  const { data: client } = await supabase
    .from("clients")
    .select(
      "id, clinic_id, full_name, cpf, birth_date, phone, email, address, address_number, complement, neighborhood, city, state, zip_code, notes, status, created_at, journey_phase, phase_entered_at, methodology_pillar"
    )
    .eq("id", id)
    .single();

  if (!client) notFound();

  const [{ data: history }, { data: appointments }] = await Promise.all([
    supabase
      .from("journey_phase_history")
      .select("id, phase, entered_at, exited_at, profiles ( full_name )")
      .eq("client_id", id)
      .order("entered_at")
      .returns<HistoryRow[]>(),
    supabase
      .from("appointments")
      .select("id, type, status, starts_at")
      .eq("client_id", id)
      .order("starts_at")
      .returns<ClientAppointment[]>(),
  ]);

  // LGPD: every view of a client record is audited.
  await logAudit({
    action: "view",
    entityType: "client",
    entityId: client.id,
    clinicId: client.clinic_id,
  });

  const canEdit =
    client.status !== "anonymized" &&
    hasRoleInClinic(session, client.clinic_id, ["receptionist"]);

  const canMove = hasRoleInClinic(session, client.clinic_id, [
    "receptionist",
    "clinical_coordinator",
    "planner_dentist",
    "commercial_consultant",
    "commercial_assistant",
  ]);

  const historyEntries: HistoryEntry[] = (history ?? []).map((h) => ({
    id: h.id,
    phase: h.phase,
    entered_at: h.entered_at,
    exited_at: h.exited_at,
    moved_by_name: h.profiles?.full_name ?? null,
  }));

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {client.full_name}
          </h1>
          <p className="text-sm text-muted-foreground">
            Cliente desde{" "}
            {new Date(client.created_at).toLocaleDateString("pt-BR")}
          </p>
        </div>
        <Badge variant={client.status === "active" ? "secondary" : "outline"}>
          {STATUS_LABELS[client.status as keyof typeof STATUS_LABELS]}
        </Badge>
      </div>

      <JourneySection
        clientId={client.id}
        clientName={client.full_name}
        phase={client.journey_phase as JourneyPhase}
        phaseEnteredAt={client.phase_entered_at}
        pillar={client.methodology_pillar as MethodologyPillar | null}
        history={historyEntries}
        appointments={appointments ?? []}
        canMove={canMove}
      />

      {canEdit ? (
        <ClientForm client={client} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Dados do cliente</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">CPF</dt>
                <dd>{client.cpf ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Nascimento</dt>
                <dd>
                  {client.birth_date
                    ? new Date(
                        `${client.birth_date}T00:00:00`
                      ).toLocaleDateString("pt-BR")
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Telefone</dt>
                <dd>{client.phone ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">E-mail</dt>
                <dd>{client.email ?? "—"}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">Endereço</dt>
                <dd>
                  {[
                    [client.address, client.address_number]
                      .filter(Boolean)
                      .join(", nº "),
                    client.complement,
                    client.neighborhood,
                    client.city,
                    client.state,
                    client.zip_code,
                  ]
                    .filter(Boolean)
                    .join(", ") || "—"}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">Observações</dt>
                <dd>{client.notes ?? "—"}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
