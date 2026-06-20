import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  JOURNEY_PHASES,
  TREATMENT_PILLARS,
  PHASE_LABELS,
  PILLAR_LABELS,
  type JourneyPhase,
  type JourneyStatus,
} from "@/lib/journey";

export const metadata: Metadata = { title: "Clientes" };

type ClientRow = {
  id: string;
  code: string | null;
  full_name: string;
  phone: string | null;
  email: string | null;
  status: "active" | "inactive" | "anonymized";
  journey_phase: JourneyPhase;
  journey_status: JourneyStatus | null;
  created_at: string;
  clinic_id: string;
  clinics: { name: string } | null;
};

type TransferredRow = {
  id: string;
  full_name: string;
  clinics: { name: string } | null;
};

const STATUS_LABELS: Record<ClientRow["status"], string> = {
  active: "Ativo",
  inactive: "Inativo",
  anonymized: "Anonimizado",
};

export default async function ClientsPage(props: PageProps<"/clientes">) {
  const session = await getSessionContext();
  const searchParams = await props.searchParams;
  const query = typeof searchParams.q === "string" ? searchParams.q.trim() : "";
  const clinicFilter =
    typeof searchParams.clinica === "string" ? searchParams.clinica : "";
  const phaseFilter =
    typeof searchParams.fase === "string" ? searchParams.fase : "";
  const pillarFilter =
    typeof searchParams.pilar === "string" ? searchParams.pilar : "";
  const statusFilter =
    typeof searchParams.status === "string" ? searchParams.status : "";

  const clinicId = session.activeClinic?.id;
  const isFranchisor = session.activeClinic?.type === "franchisor";
  const fRoles = clinicId ? (session.rolesByClinic[clinicId] ?? []) : [];
  // Receptionist (unit) or SDR (franqueadora) can register clients.
  const canCreate = hasRoleInClinic(session, clinicId, ["receptionist", "sdr"]);

  // In the Franqueadora the list is tailored to the user's role.
  const franchisorMode: "network" | "consultant" | "planner" | "sdr" =
    session.isAdminMaster
      ? "network"
      : fRoles.includes("commercial_consultant")
        ? "consultant"
        : fRoles.includes("planner_dentist")
          ? "planner"
          : fRoles.includes("sdr")
            ? "sdr"
            : "network";

  function applyFilters<
    T extends {
      eq: (col: string, val: string) => T;
      neq: (col: string, val: string) => T;
      ilike: (col: string, val: string) => T;
    },
  >(request: T): T {
    let r = request;
    if (query) r = r.ilike("full_name", `%${query}%`);
    if (phaseFilter) r = r.eq("journey_phase", phaseFilter);
    if (pillarFilter) r = r.eq("methodology_pillar", pillarFilter);
    // Status filter (default hides anonymized clients).
    if (statusFilter) r = r.eq("status", statusFilter);
    else r = r.neq("status", "anonymized");
    return r;
  }

  const supabase = await createClient();

  let clients: ClientRow[] = [];
  let transferred: TransferredRow[] = [];
  let sharedWithUnit: TransferredRow[] = [];
  let clinicOptions: { id: string; name: string }[] = [];

  const SELECT =
    "id, code, full_name, phone, email, status, journey_phase, journey_status, created_at, clinic_id, clinics!clients_clinic_id_fkey ( name )";

  // Clients in treatment_start "awaiting start" with no future appointment.
  const awaitingSchedule = new Set<string>();

  if (clinicId) {
    if (isFranchisor) {
      const { data: clinicsData } = await supabase
        .from("clinics")
        .select("id, name")
        .eq("type", "franchise_unit")
        .order("name");
      clinicOptions = clinicsData ?? [];

      if (franchisorMode === "consultant") {
        // Consultor: only the clients scheduled for / presented by him.
        const { data: appts } = await supabase
          .from("appointments")
          .select("client_id")
          .eq("provider_user_id", session.userId);
        const ids = [...new Set((appts ?? []).map((a) => a.client_id))];
        if (ids.length > 0) {
          let request = supabase
            .from("clients")
            .select(SELECT)
            .in("id", ids)
            .order("full_name")
            .limit(200);
          if (clinicFilter) request = request.eq("clinic_id", clinicFilter);
          request = applyFilters(request);
          clients = (await request.returns<ClientRow[]>()).data ?? [];
        }
      } else {
        let request = supabase
          .from("clients")
          .select(SELECT)
          .order("full_name")
          .limit(200);
        if (clinicFilter) request = request.eq("clinic_id", clinicFilter);
        if (franchisorMode === "sdr") {
          request = request.eq("created_by", session.userId);
        }
        // Default phases per role (a chosen phase filter overrides them).
        if (!phaseFilter) {
          if (franchisorMode === "planner") {
            request = request.in("journey_phase", [
              "clinical_conversion",
              "planning_center",
              "commercial_conversion",
              "reevaluation",
            ]);
          } else if (franchisorMode === "sdr") {
            request = request.in("journey_phase", [
              "acquisition",
              "clinical_conversion",
              "treatment_start",
            ]);
          }
        }
        request = applyFilters(request);
        clients = (await request.returns<ClientRow[]>()).data ?? [];
      }
    } else {
      let request = supabase
        .from("clients")
        .select(SELECT)
        // Clients of this unit, plus SDR-registered clients who prefer it.
        .or(`clinic_id.eq.${clinicId},preferred_clinic_id.eq.${clinicId}`)
        .order("full_name")
        .limit(100);
      request = applyFilters(request);
      const { data } = await request.returns<ClientRow[]>();
      clients = data ?? [];

      // Flag clients "awaiting treatment start" that still have no future
      // appointment — reception must schedule them (alert icon + banner).
      const awaitCandidates = clients.filter(
        (c) =>
          c.journey_phase === "treatment_start" &&
          c.journey_status === "awaiting_treatment_start"
      );
      if (awaitCandidates.length > 0) {
        const { data: futureAppts } = await supabase
          .from("appointments")
          .select("client_id")
          .in(
            "client_id",
            awaitCandidates.map((c) => c.id)
          )
          .gt("starts_at", new Date().toISOString())
          .in("status", ["scheduled", "confirmed"]);
        const haveFuture = new Set(
          (futureAppts ?? []).map((a) => a.client_id as string)
        );
        for (const c of awaitCandidates) {
          if (!haveFuture.has(c.id)) awaitingSchedule.add(c.id);
        }
      }

      // Clients this unit served in the past, now in another unit.
      const { data: pastHistory } = await supabase
        .from("client_clinic_history")
        .select("client_id")
        .eq("clinic_id", clinicId)
        .not("ended_at", "is", null);
      const pastIds = [...new Set((pastHistory ?? []).map((h) => h.client_id))];
      if (pastIds.length > 0) {
        const { data: transferredData } = await supabase
          .from("clients")
          .select("id, full_name, clinics!clients_clinic_id_fkey ( name )")
          .in("id", pastIds)
          .neq("clinic_id", clinicId)
          .order("full_name")
          .returns<TransferredRow[]>();
        transferred = transferredData ?? [];
      }

      // Clients actively shared WITH this unit (their home unit is another one).
      const { data: shareRows } = await supabase
        .from("client_shares")
        .select("client_id")
        .eq("clinic_id", clinicId)
        .is("ended_at", null);
      const sharedIds = [
        ...new Set((shareRows ?? []).map((s) => s.client_id as string)),
      ];
      if (sharedIds.length > 0) {
        const { data: sharedData } = await supabase
          .from("clients")
          .select("id, full_name, clinics!clients_clinic_id_fkey ( name )")
          .in("id", sharedIds)
          .neq("clinic_id", clinicId)
          .order("full_name")
          .returns<TransferredRow[]>();
        sharedWithUnit = sharedData ?? [];
      }
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Clientes{" "}
            <span className="text-base font-normal text-muted-foreground">
              ({clients.length})
            </span>
          </h1>
          <p className="text-sm text-muted-foreground">
            {!session.activeClinic
              ? "Selecione uma clínica no menu lateral."
              : !isFranchisor
                ? `Clientes de ${session.activeClinic.name}.`
                : franchisorMode === "consultant"
                  ? "Seus clientes (agendados para você ou que você apresentou)."
                  : franchisorMode === "planner"
                    ? "Clientes da rede nas fases de planejamento (2, 3, 4 e 6)."
                    : franchisorMode === "sdr"
                      ? "Clientes que você cadastrou (em aquisição, conversão clínica e tratamento)."
                      : "Visão da rede — todos os clientes de todas as unidades."}
          </p>
        </div>
        {canCreate && (
          <Button nativeButton={false} render={<Link href="/clientes/novo" />}>
            Novo cliente
          </Button>
        )}
      </div>

      <form method="get" className="flex max-w-xl flex-wrap gap-2">
        <Input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Buscar por nome..."
          className="max-w-xs"
        />
        {isFranchisor && (
          <select
            name="clinica"
            defaultValue={clinicFilter}
            className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
          >
            <option value="">Todas as unidades</option>
            {clinicOptions.map((clinic) => (
              <option key={clinic.id} value={clinic.id}>
                {clinic.name}
              </option>
            ))}
          </select>
        )}
        <select
          name="fase"
          defaultValue={phaseFilter}
          className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
        >
          <option value="">Todas as fases</option>
          {JOURNEY_PHASES.map((phase) => (
            <option key={phase} value={phase}>
              {PHASE_LABELS[phase]}
            </option>
          ))}
        </select>
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
        <Button type="submit" variant="outline">
          Buscar
        </Button>
      </form>

      {awaitingSchedule.size > 0 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4">
          <h2 className="flex items-center gap-2 text-sm font-medium text-destructive">
            <AlertTriangle className="size-4" />
            {awaitingSchedule.size} cliente(s) aguardando agendamento de início de
            tratamento
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Estes clientes estão “Aguardando Iniciar Tratamento” e ainda não têm
            horário marcado. Faça o agendamento do início do tratamento.
          </p>
          <ul className="mt-2 space-y-1">
            {clients
              .filter((client) => awaitingSchedule.has(client.id))
              .map((client) => (
                <li key={client.id} className="text-sm">
                  <Link
                    href={`/clientes/${client.id}`}
                    className="font-medium hover:underline"
                  >
                    {client.full_name}
                  </Link>
                </li>
              ))}
          </ul>
        </div>
      )}

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">Código</TableHead>
              <TableHead>Nome</TableHead>
              {isFranchisor && <TableHead>Unidade</TableHead>}
              <TableHead>Fase da jornada</TableHead>
              <TableHead>Telefone</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clients.map((client) => (
              <TableRow key={client.id}>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {client.code ?? "—"}
                </TableCell>
                <TableCell className="font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    {awaitingSchedule.has(client.id) && (
                      <AlertTriangle
                        className="size-4 shrink-0 text-destructive"
                        aria-label="Aguardando agendamento de tratamento"
                      />
                    )}
                    {client.full_name}
                  </span>
                </TableCell>
                {isFranchisor && (
                  <TableCell>{client.clinics?.name ?? "—"}</TableCell>
                )}
                <TableCell>
                  <Badge variant="secondary">
                    {PHASE_LABELS[client.journey_phase]}
                  </Badge>
                </TableCell>
                <TableCell>{client.phone ?? "—"}</TableCell>
                <TableCell>
                  <Badge
                    variant={client.status === "active" ? "secondary" : "outline"}
                  >
                    {STATUS_LABELS[client.status]}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    nativeButton={false}
                    render={<Link href={`/clientes/${client.id}`} />}
                  >
                    Abrir
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {clients.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={isFranchisor ? 7 : 6}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  {query
                    ? "Nenhum cliente encontrado com esse nome."
                    : "Nenhum cliente cadastrado ainda."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {transferred.length > 0 && (
        <div className="rounded-md border bg-muted/40 p-4">
          <h2 className="mb-2 text-sm font-medium">
            Transferidos para outras unidades
          </h2>
          <ul className="space-y-1">
            {transferred.map((client) => (
              <li key={client.id} className="flex items-center gap-2 text-sm">
                <Link
                  href={`/clientes/${client.id}`}
                  className="hover:underline"
                >
                  {client.full_name}
                </Link>
                <Badge variant="destructive" className="text-[10px]">
                  Transferido para {client.clinics?.name ?? "outra unidade"}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}

      {sharedWithUnit.length > 0 && (
        <div className="rounded-md border border-gold/40 bg-gold/5 p-4">
          <h2 className="mb-2 text-sm font-medium">
            Compartilhados com a unidade (temporário)
          </h2>
          <ul className="space-y-1">
            {sharedWithUnit.map((client) => (
              <li key={client.id} className="flex items-center gap-2 text-sm">
                <Link
                  href={`/clientes/${client.id}`}
                  className="font-medium hover:underline"
                >
                  {client.full_name}
                </Link>
                <Badge variant="secondary" className="text-[10px]">
                  Unidade de origem: {client.clinics?.name ?? "outra unidade"}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
