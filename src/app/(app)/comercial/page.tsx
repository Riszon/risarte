import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Handshake } from "lucide-react";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import {
  commercialColumnOf,
  type CardStage,
  type NegotiationStatus,
} from "@/lib/commercial";
import { CommercialKanban, type BoardCard } from "./kanban-board";

export const metadata: Metadata = { title: "Comercial" };

/**
 * COM3: Kanban do Comercial — funil da Fase 4 (+ Fase 5) com follow-up. As
 * colunas de fechamento e da Fase 5 são derivadas (negociação aceita/jornada);
 * as demais vêm do cartão (commercial_cards). Escopo do usuário garantido pela
 * RLS de clients/cards.
 */
export default async function ComercialKanbanPage() {
  const session = await getSessionContext();
  const isCommercial = Object.values(session.rolesByClinic)
    .flat()
    .some((r) => ["commercial_consultant", "commercial_assistant"].includes(r));
  const isManagerAnywhere = Object.values(session.rolesByClinic)
    .flat()
    .some((r) => r === "unit_manager");
  if (!session.isAdminMaster && !isCommercial && !isManagerAnywhere) {
    redirect("/");
  }

  await logAudit({ action: "view", entityType: "commercial_kanban", entityId: "board" });

  const supabase = await createClient();

  // Clientes do funil comercial: Fase 4 (Conversão Comercial) + Fase 5 (Início
  // de Tratamento). RLS já limita ao escopo do usuário.
  const { data: clientRows } = await supabase
    .from("clients")
    .select(
      "id, full_name, code, phone, clinic_id, journey_phase, journey_status, clinic:clinics!clients_clinic_id_fkey ( name )"
    )
    .in("journey_phase", ["commercial_conversion", "treatment_start"])
    .neq("status", "anonymized")
    .order("full_name");

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

  // Cartões do funil + negociação (situação/valor) por cliente.
  const cardByClient = new Map<
    string,
    { stage: CardStage; attempts: number; next: string | null; reason: string | null }
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
          "client_id, stage, followup_attempts, next_attempt_at, outcome_reason"
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
    }[]) {
      cardByClient.set(c.client_id, {
        stage: c.stage,
        attempts: c.followup_attempts,
        next: c.next_attempt_at,
        reason: c.outcome_reason,
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

  const boardCards: BoardCard[] = clients.map((c) => {
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
      outcomeReason: card?.reason ?? null,
    };
  });

  // Só quem pode agir no funil (Consultor c/ escopo, Gerente, Admin) vê os
  // botões — a leitura é mais ampla (equipe/gestão). Aproximação por papel na
  // unidade ativa; a RPC revalida no servidor.
  const canManage =
    session.isAdminMaster ||
    isCommercial ||
    (session.activeClinic
      ? hasRoleInClinic(session, session.activeClinic.id, ["unit_manager"])
      : false);

  return (
    <div className="flex h-[calc(100vh-1px)] flex-col px-4 py-4">
      <div className="mb-3 shrink-0">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Handshake className="size-6 text-gold" />
          Comercial
        </h1>
        <p className="text-sm text-muted-foreground">
          Funil de conversão — da apresentação ao início do tratamento. Clique
          em um cartão para abrir o Cockpit do Consultor.
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-x-auto pb-2">
        <CommercialKanban cards={boardCards} canManage={canManage} />
      </div>
    </div>
  );
}
