import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Gift } from "lucide-react";
import {
  getSessionContext,
  hasRoleInClinic,
  sdrAccessibleClientIds,
} from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FilterForm } from "@/components/filter-form";
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
import {
  filterBirthdays,
  BIRTHDAY_SCOPE_LABELS,
  type BirthdayClient,
  type BirthdayScope,
} from "@/lib/birthdays";
import { ShareByCpf } from "./share-by-cpf";
import { BirthdayWhatsApp } from "./birthday-whatsapp";
import { SharedClientsList, type SharedEntry } from "./shared-clients-list";
import { notifyUnitBirthdays } from "./actions";

export const metadata: Metadata = { title: "Prontuários" };

// UUID inexistente para uma cláusula .in([]) nunca casar (evita erro/lista cheia).
const NO_MATCH_ID = "00000000-0000-0000-0000-000000000000";

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

type BirthdayRow = {
  id: string;
  full_name: string;
  birth_date: string;
  phone: string | null;
  status: ClientRow["status"];
};

const STATUS_LABELS: Record<ClientRow["status"], string> = {
  active: "Ativo",
  inactive: "Inativo",
  anonymized: "Anonimizado",
};

type Tab = "ativos" | "aniversariantes" | "transferidos" | "compartilhados";
const TAB_LABELS: Record<Tab, string> = {
  // H2.1: a contagem soma ativos+inativos, então a aba chama "Clientes".
  ativos: "Clientes",
  aniversariantes: "Aniversariantes",
  transferidos: "Transferidos",
  compartilhados: "Compartilhados",
};

const BIRTHDAY_SCOPES: BirthdayScope[] = ["hoje", "semana", "mes"];

/** DD/MM de uma data YYYY-MM-DD (sem criar Date, evita fuso). */
function ddmm(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

export default async function ClientsPage(props: PageProps<"/prontuarios">) {
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
  const tab: Tab =
    searchParams.aba === "aniversariantes" ||
    searchParams.aba === "transferidos" ||
    searchParams.aba === "compartilhados"
      ? searchParams.aba
      : "ativos";
  const birthdayScope: BirthdayScope =
    searchParams.quando === "hoje" || searchParams.quando === "mes"
      ? searchParams.quando
      : "semana";

  const clinicId = session.activeClinic?.id;
  const isFranchisor = session.activeClinic?.type === "franchisor";
  const fRoles = clinicId ? (session.rolesByClinic[clinicId] ?? []) : [];
  // Receptionist (unit) or SDR (franqueadora) can register clients.
  const canCreate = hasRoleInClinic(session, clinicId, ["receptionist", "sdr"]);
  // Unit staff can pull (share) a client from another unit by CPF (E7).
  const canShareByCpf =
    !isFranchisor &&
    hasRoleInClinic(session, clinicId, [
      "receptionist",
      "clinical_coordinator",
      "unit_manager",
    ]);
  // Recepção/Coordenador/Gerente (ou Admin) podem encerrar compartilhamento (H1.8).
  const canEndShare =
    session.isAdminMaster ||
    hasRoleInClinic(session, clinicId, [
      "receptionist",
      "clinical_coordinator",
      "unit_manager",
    ]);

  // P2: aviso de aniversariantes para a Recepção (idempotente, antecipa fim de
  // semana/feriado) — disparado também ao abrir os Prontuários da unidade.
  if (
    !isFranchisor &&
    clinicId &&
    (session.isAdminMaster ||
      hasRoleInClinic(session, clinicId, [
        "receptionist",
        "unit_manager",
        "clinical_coordinator",
      ]))
  ) {
    await notifyUnitBirthdays(clinicId);
  }

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
  let sharedEntries: SharedEntry[] = [];
  let birthdays: BirthdayClient[] = [];
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
          // H3.7: a SDR vê os clientes que TOCOU (cadastrou/editou/agendou/
          // transferiu), não só os que cadastrou.
          const ids = await sdrAccessibleClientIds();
          request = request.in("id", ids.length > 0 ? ids : [NO_MATCH_ID]);
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

      // Compartilhamentos ativos ligados a esta unidade (H1.8): tanto os que
      // ela RECEBEU (é a unidade B) quanto os que ela COMPARTILHOU (é a A),
      // com detalhes (motivo, quando, quem, clínica dona) + Encerrar.
      const shareSelect =
        "id, reason, started_at, clinic_id, shared_by, target:clinics!client_shares_clinic_id_fkey ( name ), client:clients!client_shares_client_id_fkey ( id, full_name, clinic_id, home:clinics!clients_clinic_id_fkey ( name ) ), sharer:profiles!client_shares_shared_by_fkey ( full_name )";
      type ShareRow = {
        id: string;
        reason: string | null;
        started_at: string;
        clinic_id: string;
        shared_by: string | null;
        target: { name: string } | null;
        client: {
          id: string;
          full_name: string;
          clinic_id: string;
          home: { name: string } | null;
        } | null;
        sharer: { full_name: string } | null;
      };
      const [{ data: incoming }, { data: outgoing }] = await Promise.all([
        // Recebidos: esta unidade é o destino (B).
        supabase
          .from("client_shares")
          .select(shareSelect)
          .eq("clinic_id", clinicId)
          .is("ended_at", null)
          .returns<ShareRow[]>(),
        // Enviados: o cliente é desta unidade (A) e o destino é outra.
        supabase
          .from("client_shares")
          .select(shareSelect)
          .eq("client.clinic_id", clinicId)
          .neq("clinic_id", clinicId)
          .is("ended_at", null)
          .returns<ShareRow[]>(),
      ]);
      const mapShare = (s: ShareRow, direction: "in" | "out"): SharedEntry => ({
        shareId: s.id,
        clientId: s.client?.id ?? "",
        clientName: s.client?.full_name ?? "Cliente",
        homeClinicName: s.client?.home?.name ?? "outra unidade",
        sharedClinicName: s.target?.name ?? "outra unidade",
        reason: s.reason,
        startedAt: s.started_at,
        sharedByName: s.sharer?.full_name ?? null,
        direction,
      });
      sharedEntries = [
        ...(incoming ?? [])
          .filter((s) => s.client)
          .map((s) => mapShare(s, "in")),
        ...(outgoing ?? [])
          .filter((s) => s.client)
          .map((s) => mapShare(s, "out")),
      ].sort((a, b) => a.clientName.localeCompare(b.clientName));

      // Aniversariantes da unidade (ativos e inativos; anonimizados não).
      const { data: birthdayRows } = await supabase
        .from("clients")
        .select("id, full_name, birth_date, phone, status")
        .or(`clinic_id.eq.${clinicId},preferred_clinic_id.eq.${clinicId}`)
        .neq("status", "anonymized")
        .not("birth_date", "is", null)
        .returns<BirthdayRow[]>();
      birthdays = (birthdayRows ?? []).map((r) => ({
        id: r.id,
        fullName: r.full_name,
        birthDate: r.birth_date,
        phone: r.phone,
        status: r.status,
      }));
    }
  }

  // Faixas de aniversário (a aba só existe para unidades).
  const now = new Date();
  const birthdayList = filterBirthdays(birthdays, birthdayScope, now);
  const birthdayTodayCount = filterBirthdays(birthdays, "hoje", now).length;
  const birthdayMonthCount = filterBirthdays(birthdays, "mes", now).length;

  const tabCounts: Record<Tab, number> = {
    ativos: clients.length,
    aniversariantes: birthdayMonthCount,
    transferidos: transferred.length,
    compartilhados: sharedEntries.length,
  };
  const tabs: Tab[] = isFranchisor
    ? ["ativos"]
    : ["ativos", "aniversariantes", "transferidos", "compartilhados"];

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Prontuários</h1>
          <p className="text-sm text-muted-foreground">
            {!session.activeClinic
              ? "Selecione uma clínica no menu lateral."
              : !isFranchisor
                ? `Prontuários de ${session.activeClinic.name}.`
                : franchisorMode === "consultant"
                  ? "Seus clientes (agendados para você ou que você apresentou)."
                  : franchisorMode === "planner"
                    ? "Clientes da rede nas fases de planejamento (2, 3, 4 e 6)."
                    : franchisorMode === "sdr"
                      ? "Clientes que você cadastrou (em aquisição, conversão clínica e tratamento)."
                      : "Visão da rede — todos os clientes de todas as unidades."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canShareByCpf && <ShareByCpf />}
          {canCreate && (
            <Button nativeButton={false} render={<Link href="/prontuarios/novo" />}>
              Novo cliente
            </Button>
          )}
        </div>
      </div>

      {/* Abas (Ativos / Aniversariantes / Transferidos / Compartilhados) ----- */}
      {tabs.length > 1 && (
        <div className="flex flex-wrap gap-1 border-b">
          {tabs.map((t) => (
            <Link
              key={t}
              href={t === "ativos" ? "/prontuarios" : `/prontuarios?aba=${t}`}
              className={cn(
                "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors",
                tab === t
                  ? "border-primary font-medium text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {t === "aniversariantes" && <Gift className="size-4" />}
              {TAB_LABELS[t]}
              <span
                className={cn(
                  "rounded-full px-1.5 text-xs",
                  tab === t ? "bg-primary/10" : "bg-muted"
                )}
              >
                {tabCounts[t]}
              </span>
            </Link>
          ))}
        </div>
      )}

      {/* ABA: ATIVOS -------------------------------------------------------- */}
      {tab === "ativos" && (
        <>
          <FilterForm className="flex max-w-xl flex-wrap gap-2">
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
          </FilterForm>

          {awaitingSchedule.size > 0 && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4">
              <h2 className="flex items-center gap-2 text-sm font-medium text-destructive">
                <AlertTriangle className="size-4" />
                {awaitingSchedule.size} cliente(s) aguardando agendamento de início
                de tratamento
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Estes clientes estão “Aguardando Iniciar Tratamento” e ainda não
                têm horário marcado. Faça o agendamento do início do tratamento.
              </p>
              <ul className="mt-2 space-y-1">
                {clients
                  .filter((client) => awaitingSchedule.has(client.id))
                  .map((client) => (
                    <li key={client.id} className="text-sm">
                      <Link
                        href={`/prontuarios/${client.id}`}
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
                        variant={
                          client.status === "active" ? "secondary" : "outline"
                        }
                      >
                        {STATUS_LABELS[client.status]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        nativeButton={false}
                        render={<Link href={`/prontuarios/${client.id}`} />}
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
        </>
      )}

      {/* ABA: ANIVERSARIANTES ---------------------------------------------- */}
      {tab === "aniversariantes" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {BIRTHDAY_SCOPES.map((s) => (
              <Button
                key={s}
                size="sm"
                variant={birthdayScope === s ? "default" : "outline"}
                nativeButton={false}
                render={
                  <Link href={`/prontuarios?aba=aniversariantes&quando=${s}`} />
                }
              >
                {BIRTHDAY_SCOPE_LABELS[s]}
                {s === "hoje" && birthdayTodayCount > 0 ? (
                  <span className="ml-1.5 rounded-full bg-gold/20 px-1.5 text-xs text-gold-foreground">
                    {birthdayTodayCount}
                  </span>
                ) : null}
              </Button>
            ))}
            <p className="text-xs text-muted-foreground">
              {birthdayScope === "hoje"
                ? "Aniversariantes de hoje."
                : birthdayScope === "semana"
                  ? "Aniversariantes nos próximos 7 dias."
                  : "Aniversariantes do mês atual."}
            </p>
          </div>

          {/* H3.8: parabenizar por WhatsApp (individual e em massa). */}
          <BirthdayWhatsApp
            clients={birthdayList.map((p) => ({
              id: p.id,
              fullName: p.fullName,
              phone: p.phone,
            }))}
          />

          <div className="rounded-md border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead className="w-28">Aniversário</TableHead>
                  <TableHead className="w-24">Faz</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-20"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {birthdayList.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        {p.daysUntil === 0 && (
                          <Gift
                            className="size-4 shrink-0 text-gold"
                            aria-label="Aniversário hoje"
                          />
                        )}
                        {p.fullName}
                      </span>
                    </TableCell>
                    <TableCell>
                      {ddmm(p.birthDate)}
                      {p.daysUntil === 0 ? (
                        <span className="ml-1 text-xs font-medium text-gold">
                          hoje
                        </span>
                      ) : p.daysUntil === 1 ? (
                        <span className="ml-1 text-xs text-muted-foreground">
                          amanhã
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {p.turningAge} anos
                    </TableCell>
                    <TableCell>{p.phone ?? "—"}</TableCell>
                    <TableCell>
                      <Badge
                        variant={p.status === "active" ? "secondary" : "outline"}
                      >
                        {STATUS_LABELS[p.status ?? "active"]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        nativeButton={false}
                        render={<Link href={`/prontuarios/${p.id}`} />}
                      >
                        Abrir
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {birthdayList.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      Nenhum aniversariante nesta faixa.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* ABA: TRANSFERIDOS -------------------------------------------------- */}
      {tab === "transferidos" && (
        <div className="rounded-md border bg-card p-4">
          <p className="mb-3 text-sm text-muted-foreground">
            Clientes que sua unidade já atendeu e que hoje pertencem a outra
            unidade.
          </p>
          {transferred.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhum cliente transferido para outra unidade.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {transferred.map((client) => (
                <li key={client.id} className="flex items-center gap-2 text-sm">
                  <Link
                    href={`/prontuarios/${client.id}`}
                    className="font-medium hover:underline"
                  >
                    {client.full_name}
                  </Link>
                  <Badge variant="destructive" className="text-[10px]">
                    Transferido para {client.clinics?.name ?? "outra unidade"}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ABA: COMPARTILHADOS ----------------------------------------------- */}
      {tab === "compartilhados" && (
        <div className="rounded-md border border-gold/40 bg-gold/5 p-4">
          <p className="mb-3 text-sm text-muted-foreground">
            Compartilhamentos ativos da sua unidade — os que você recebeu de
            outra unidade e os que compartilhou com outra. Qualquer uma das duas
            unidades pode encerrar.
          </p>
          {sharedEntries.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhum compartilhamento ativo no momento.
            </p>
          ) : (
            <SharedClientsList entries={sharedEntries} canEnd={canEndShare} />
          )}
        </div>
      )}
    </div>
  );
}
