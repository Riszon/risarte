import type { Metadata } from "next";
import Link from "next/link";
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

  const clinicId = session.activeClinic?.id;
  const isFranchisor = session.activeClinic?.type === "franchisor";
  const canCreate =
    !isFranchisor &&
    hasRoleInClinic(session, clinicId, ["receptionist", "sdr"]);

  function applyFilters<
    T extends {
      eq: (col: string, val: string) => T;
      ilike: (col: string, val: string) => T;
    },
  >(request: T): T {
    let r = request;
    if (query) r = r.ilike("full_name", `%${query}%`);
    if (phaseFilter) r = r.eq("journey_phase", phaseFilter);
    if (pillarFilter) r = r.eq("methodology_pillar", pillarFilter);
    return r;
  }

  const supabase = await createClient();

  let clients: ClientRow[] = [];
  let transferred: TransferredRow[] = [];
  let clinicOptions: { id: string; name: string }[] = [];

  if (clinicId) {
    if (isFranchisor) {
      // Franchisor context = the whole network, with an optional unit filter.
      let request = supabase
        .from("clients")
        .select(
          "id, code, full_name, phone, email, status, journey_phase, created_at, clinic_id, clinics ( name )"
        )
        .order("full_name")
        .limit(200);
      if (clinicFilter) request = request.eq("clinic_id", clinicFilter);
      request = applyFilters(request);
      const [{ data }, { data: clinicsData }] = await Promise.all([
        request.returns<ClientRow[]>(),
        supabase
          .from("clinics")
          .select("id, name")
          .eq("type", "franchise_unit")
          .order("name"),
      ]);
      clients = data ?? [];
      clinicOptions = clinicsData ?? [];
    } else {
      let request = supabase
        .from("clients")
        .select(
          "id, code, full_name, phone, email, status, journey_phase, created_at, clinic_id, clinics ( name )"
        )
        .eq("clinic_id", clinicId)
        .order("full_name")
        .limit(100);
      request = applyFilters(request);
      const { data } = await request.returns<ClientRow[]>();
      clients = data ?? [];

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
          .select("id, full_name, clinics ( name )")
          .in("id", pastIds)
          .neq("clinic_id", clinicId)
          .order("full_name")
          .returns<TransferredRow[]>();
        transferred = transferredData ?? [];
      }
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clientes</h1>
          <p className="text-sm text-muted-foreground">
            {!session.activeClinic
              ? "Selecione uma clínica no menu lateral."
              : isFranchisor
                ? "Visão da rede — todos os clientes de todas as unidades."
                : `Clientes de ${session.activeClinic.name}.`}
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
        <Button type="submit" variant="outline">
          Buscar
        </Button>
      </form>

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
                  {client.full_name}
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
    </div>
  );
}
