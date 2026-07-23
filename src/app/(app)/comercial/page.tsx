import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Eye, Handshake } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { cn } from "@/lib/utils";
import {
  commercialColumnOf,
  type CardStage,
  type NegotiationStatus,
} from "@/lib/commercial";
import {
  CommercialKanban,
  type BoardCard,
  type ViewerKind,
} from "./kanban-board";

export const metadata: Metadata = { title: "Comercial" };

export default async function ComercialKanbanPage(
  props: PageProps<"/comercial">
) {
  const session = await getSessionContext();
  const roles = Object.values(session.rolesByClinic).flat();
  const isCommercial = roles.some((r) =>
    ["commercial_consultant", "commercial_assistant"].includes(r)
  );
  const isUnitViewer = roles.some((r) =>
    ["unit_manager", "franchisee"].includes(r)
  );
  if (!session.isAdminMaster && !isCommercial && !isUnitViewer) {
    redirect("/");
  }

  // Quem AGE no funil = comercial/admin; a unidade (gerente/franqueado) só
  // VISUALIZA (e ajuda no follow-up liberado).
  const viewer: ViewerKind =
    session.isAdminMaster || isCommercial ? "commercial" : "unit";
  const canSeeAllUnits = session.isAdminMaster || isCommercial;
  const activeClinicId = session.activeClinic?.id ?? null;

  // Escopo: por padrão SÓ a unidade logada. Comercial/Admin podem filtrar
  // (todas as unidades ou uma específica).
  const unidadeParam = (await props.searchParams).unidade;
  const unidade = Array.isArray(unidadeParam) ? unidadeParam[0] : unidadeParam;
  let clinicFilter: string | null;
  if (!canSeeAllUnits) {
    clinicFilter = activeClinicId; // unidade travada na clínica logada
  } else if (unidade === "all") {
    clinicFilter = null;
  } else if (unidade) {
    clinicFilter = unidade;
  } else {
    clinicFilter = activeClinicId;
  }

  await logAudit({
    action: "view",
    entityType: "commercial_kanban",
    entityId: clinicFilter ?? "all",
    clinicId: clinicFilter ?? undefined,
  });

  const supabase = await createClient();

  let clientsQuery = supabase
    .from("clients")
    .select(
      "id, full_name, code, phone, clinic_id, journey_phase, journey_status, clinic:clinics!clients_clinic_id_fkey ( name )"
    )
    .in("journey_phase", ["commercial_conversion", "treatment_start"])
    .neq("status", "anonymized")
    .order("full_name");
  if (clinicFilter) clientsQuery = clientsQuery.eq("clinic_id", clinicFilter);
  const { data: clientRows } = await clientsQuery;

  const clients = (clientRows ?? []) as {
    id: string;
    full_name: string;
    code: string | null;
    phone: string | null;
    clinic_id: string;
    journey_phase: string;
    journey_status: string | null;
    clinic: { name: string } | { name: string }[] | null;
  }[];

  const ids = clients.map((c) => c.id);

  const cardByClient = new Map<
    string,
    {
      stage: CardStage;
      attempts: number;
      next: string | null;
      reason: string | null;
      byClinic: boolean;
      presentingSince: string | null;
    }
  >();
  const negByClient = new Map<
    string,
    { status: NegotiationStatus; finalCents: number }
  >();

  if (ids.length > 0) {
    const [{ data: cards }, { data: negs }] = await Promise.all([
      supabase
        .from("commercial_cards")
        .select(
          "client_id, stage, followup_attempts, next_attempt_at, outcome_reason, followup_by_clinic, presenting_since"
        )
        .in("client_id", ids),
      supabase
        .from("plan_negotiations")
        .select("client_id, status, final_cents, updated_at")
        .in("client_id", ids)
        .order("updated_at", { ascending: false }),
    ]);
    for (const c of (cards ?? []) as {
      client_id: string;
      stage: CardStage;
      followup_attempts: number;
      next_attempt_at: string | null;
      outcome_reason: string | null;
      followup_by_clinic: boolean;
      presenting_since: string | null;
    }[]) {
      cardByClient.set(c.client_id, {
        stage: c.stage,
        attempts: c.followup_attempts,
        next: c.next_attempt_at,
        reason: c.outcome_reason,
        byClinic: c.followup_by_clinic,
        presentingSince: c.presenting_since,
      });
    }
    for (const n of (negs ?? []) as {
      client_id: string;
      status: NegotiationStatus;
      final_cents: number;
    }[]) {
      if (!negByClient.has(n.client_id)) {
        negByClient.set(n.client_id, {
          status: n.status,
          finalCents: n.final_cents,
        });
      }
    }
  }

  const allCards: BoardCard[] = clients.map((c) => {
    const card = cardByClient.get(c.id) ?? null;
    const neg = negByClient.get(c.id) ?? null;
    const clinicName =
      (Array.isArray(c.clinic) ? c.clinic[0] : c.clinic)?.name ?? null;
    return {
      clientId: c.id,
      fullName: c.full_name,
      code: c.code,
      phone: c.phone,
      clinicName,
      column: commercialColumnOf({
        journeyPhase: c.journey_phase,
        journeyStatus: c.journey_status,
        cardStage: card?.stage ?? null,
        negotiationAccepted: neg?.status === "aceita",
      }),
      finalCents: neg?.finalCents ?? null,
      followupAttempts: card?.attempts ?? 0,
      nextAttemptAt: card?.next ?? null,
      followupByClinic: card?.byClinic ?? false,
      presentingSince: card?.presentingSince ?? null,
      outcomeReason: card?.reason ?? null,
    };
  });

  const lost = allCards.filter((c) => c.column === "perdido");
  const cancelled = allCards.filter((c) => c.column === "cancelado");
  const boardCards = allCards.filter(
    (c) => c.column !== "perdido" && c.column !== "cancelado"
  );

  // Unidades para o filtro (só para quem pode ver mais de uma).
  let unitOptions: { id: string; name: string }[] = [];
  if (canSeeAllUnits) {
    const { data: units } = await supabase
      .from("clinics")
      .select("id, name")
      .eq("type", "franchise_unit")
      .eq("is_active", true)
      .order("name");
    unitOptions = (units ?? []) as { id: string; name: string }[];
  }
  const currentUnitLabel = clinicFilter
    ? unitOptions.find((u) => u.id === clinicFilter)?.name ??
      session.activeClinic?.name ??
      "Unidade"
    : "Todas as unidades";

  return (
    <div className="flex h-[calc(100vh-1px)] flex-col px-4 py-4">
      <div className="mb-3 shrink-0">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Handshake className="size-6 text-gold" />
          Comercial
        </h1>
        <p className="text-sm text-muted-foreground">
          Funil de conversão — da apresentação ao início do tratamento.
          {viewer === "unit"
            ? " Sua unidade acompanha o funil; o fechamento é do Consultor."
            : " Clique em um cartão para abrir o Cockpit do Consultor."}
        </p>

        {/* Filtro de unidade (comercial/admin). */}
        {canSeeAllUnits && unitOptions.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">Unidade:</span>
            <FilterChip label="Todas" href="/comercial?unidade=all" active={clinicFilter === null} />
            {activeClinicId && (
              <FilterChip
                label={session.activeClinic?.name ?? "Minha unidade"}
                href="/comercial"
                active={clinicFilter === activeClinicId && unidade !== "all"}
              />
            )}
            {unitOptions
              .filter((u) => u.id !== activeClinicId)
              .map((u) => (
                <FilterChip
                  key={u.id}
                  label={u.name}
                  href={`/comercial?unidade=${u.id}`}
                  active={clinicFilter === u.id}
                />
              ))}
          </div>
        )}

        {viewer === "unit" && (
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
            <Eye className="size-3.5" />
            Visualização da unidade: {currentUnitLabel}. Você ajuda no follow-up
            liberado para a clínica; o fechamento é sempre do Consultor.
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-x-auto pb-2">
        <CommercialKanban
          cards={boardCards}
          lost={lost}
          cancelled={cancelled}
          viewer={viewer}
        />
      </div>
    </div>
  );
}

function FilterChip({
  label,
  href,
  active,
}: {
  label: string;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "rounded-full border px-2 py-0.5 transition-colors",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "hover:bg-muted"
      )}
    >
      {label}
    </Link>
  );
}
