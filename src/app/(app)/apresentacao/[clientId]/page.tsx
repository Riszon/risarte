import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Briefcase } from "lucide-react";
import {
  getSessionContext,
  hasRoleInClinic,
  hasRoleWithScopeForClinic,
} from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { PresentationView } from "./presentation-view";
import { loadPresentationData } from "./presentation-data";
import { loadNegotiationBlock } from "./negotiation-loader";
import { NegotiationPanel } from "./negotiation-panel";
import { ClosingPanel } from "./closing-panel";

export const metadata: Metadata = { title: "Apresentação do plano" };

export default async function PresentationPage(
  props: PageProps<"/apresentacao/[clientId]">
) {
  const { clientId } = await props.params;
  const loaded = await loadPresentationData(clientId);
  if (!loaded.ok) {
    if (loaded.reason === "not_found") notFound();
    redirect("/");
  }

  // -- COM1: painel de negociação (Consultor Comercial / Gerente / Admin) ------
  // Negociação SÓ com o cliente na Fase 4 (Conversão Comercial) — fora dela o
  // painel não aparece (e as RPCs também bloqueiam no banco).
  const session = await getSessionContext();
  const supabase = await createClient();
  const clinicId = loaded.clinicId;
  const { data: phaseRow } = await supabase
    .from("clients")
    .select("journey_phase")
    .eq("id", clientId)
    .single();
  const inCommercialPhase = phaseRow?.journey_phase === "commercial_conversion";
  const canNegotiate =
    session.isAdminMaster ||
    (await hasRoleWithScopeForClinic(session, clinicId, [
      "commercial_consultant",
    ]));
  const canAuthorize =
    session.isAdminMaster ||
    hasRoleInClinic(session, clinicId, ["unit_manager"]);
  const isCommercialTeam =
    canNegotiate ||
    (await hasRoleWithScopeForClinic(session, clinicId, [
      "commercial_assistant",
    ]));

  const negotiationBlock =
    (canNegotiate || canAuthorize) && loaded.hasApprovedPlan && inCommercialPhase
      ? await loadNegotiationBlock(clientId, clinicId)
      : null;

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      {/* COM2: atalho para o cockpit de trabalho do Consultor. */}
      {isCommercialTeam && (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<Link href={`/comercial/${clientId}`} />}
          >
            <Briefcase className="mr-1 size-3.5" />
            Cockpit do Consultor
          </Button>
        </div>
      )}
      <PresentationView data={loaded.data} clientId={clientId} />
      {negotiationBlock && (
        <NegotiationPanel
          clientId={clientId}
          planId={negotiationBlock.planId}
          options={negotiationBlock.options}
          negotiation={negotiationBlock.negotiation}
          rule={negotiationBlock.rule}
          planEvents={negotiationBlock.planEvents}
          canEdit={canNegotiate}
          canAuthorize={canAuthorize}
        />
      )}
      {/* COM4: fechamento (regra de ouro) quando o cliente aceitou. */}
      {negotiationBlock?.negotiation?.status === "aceita" && (
        <ClosingPanel
          clientId={clientId}
          negotiationId={negotiationBlock.negotiation.id}
          sale={negotiationBlock.sale}
          canClose={isCommercialTeam}
          summary={{
            finalCents: negotiationBlock.negotiation.finalCents,
            adjustmentCents: negotiationBlock.negotiation.adjustmentCents,
            paymentMethod: negotiationBlock.negotiation.paymentMethod,
            installments: negotiationBlock.negotiation.installments,
            partialReason: negotiationBlock.negotiation.partialReason,
            excludedDescriptions: negotiationBlock.excludedDescriptions,
            presentationSummary: negotiationBlock.presentationSummary,
          }}
        />
      )}
    </div>
  );
}
