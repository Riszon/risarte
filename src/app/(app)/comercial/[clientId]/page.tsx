import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  Briefcase,
  FileText,
  Layers,
  MessageCircle,
  Presentation,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import {
  getSessionContext,
  hasRoleInClinic,
  hasRoleWithScopeForClinic,
} from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { RisarteMark } from "@/components/risarte-logo";
import { PhaseBadge } from "@/components/phase-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { whatsappLink } from "@/lib/whatsapp";
import {
  PHASE_COLORS,
  PILLAR_LABELS,
  type JourneyPhase,
  type MethodologyPillar,
} from "@/lib/journey";
import {
  PLAN_STAGE_LABELS,
  PLAN_STAGE_STYLES,
  planStage,
} from "@/lib/planning";
import { loadClientPlans } from "../../prontuarios/[id]/plan-loader";
import { loadNegotiationBlock } from "../../apresentacao/[clientId]/negotiation-loader";
import { NegotiationPanel } from "../../apresentacao/[clientId]/negotiation-panel";
import {
  PresentationWorkspace,
  type PresentationData,
} from "./presentation-workspace";

export const metadata: Metadata = { title: "Cockpit do Consultor Comercial" };

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (
    (parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")
  ).toUpperCase();
}

export default async function CommercialCockpitPage(
  props: PageProps<"/comercial/[clientId]">
) {
  const session = await getSessionContext();
  const { clientId } = await props.params;
  const supabase = await createClient();

  const { data: client } = await supabase
    .from("clients")
    .select(
      "id, full_name, code, phone, clinic_id, journey_phase, methodology_pillar, empresarial_company_id, empresarial_active, clinic:clinics!clients_clinic_id_fkey ( name )"
    )
    .eq("id", clientId)
    .single();
  if (!client) notFound();

  const clinicId = client.clinic_id as string;
  const canNegotiate =
    session.isAdminMaster ||
    (await hasRoleWithScopeForClinic(session, clinicId, [
      "commercial_consultant",
    ]));
  const canView =
    canNegotiate ||
    hasRoleInClinic(session, clinicId, ["unit_manager"]) ||
    (await hasRoleWithScopeForClinic(session, clinicId, [
      "commercial_assistant",
    ]));
  if (!canView) redirect(`/prontuarios/${clientId}`);

  // LGPD: acesso ao cockpit comercial também é auditado.
  await logAudit({
    action: "view",
    entityType: "commercial_cockpit",
    entityId: clientId,
    clinicId,
  });

  const phase = client.journey_phase as JourneyPhase;
  const inCommercialPhase = phase === "commercial_conversion";
  const canAuthorize =
    session.isAdminMaster ||
    hasRoleInClinic(session, clinicId, ["unit_manager"]);

  const [presentationRow, plans, negotiationBlock, qcRows, sessRows] =
    await Promise.all([
      supabase
        .from("commercial_presentations")
        .select("meet_link, recording_url, summary, notes, consultant_id")
        .eq("client_id", clientId)
        .maybeSingle()
        .then((r) => r.data),
      loadClientPlans(clientId),
      inCommercialPhase ? loadNegotiationBlock(clientId, clinicId) : null,
      supabase
        .from("plan_quality_reviews")
        .select("status, plan:treatment_plans ( client_id )")
        .then((r) =>
          (
            (r.data ?? []) as {
              status: string;
              plan:
                | { client_id: string }
                | { client_id: string }[]
                | null;
            }[]
          ).filter((row) => {
            const p = Array.isArray(row.plan) ? row.plan[0] : row.plan;
            return p?.client_id === clientId;
          })
        ),
      supabase
        .from("treatment_sessions")
        .select("item_id, status")
        .eq("client_id", clientId)
        .then((r) => r.data ?? []),
    ]);

  const presentation: PresentationData | null = presentationRow
    ? {
        meetLink: presentationRow.meet_link,
        recordingUrl: presentationRow.recording_url,
        summary: presentationRow.summary,
        notes: presentationRow.notes,
      }
    : null;

  // Consultor responsável (quem atendeu): registrado na mesa de apresentação.
  let consultantName: string | null = null;
  if (presentationRow?.consultant_id) {
    const { data: prof } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", presentationRow.consultant_id)
      .maybeSingle();
    consultantName = prof?.full_name ?? null;
  }

  // Pendências do cliente (controle de qualidade + procedimentos em aberto).
  const qcRevisao = qcRows.filter((r) => r.status === "revisao").length;
  const qcReprovado = qcRows.filter((r) => r.status === "reprovado").length;
  const byItem = new Map<string, { total: number; done: number }>();
  for (const s of sessRows as { item_id: string | null; status: string }[]) {
    if (!s.item_id) continue;
    const a = byItem.get(s.item_id) ?? { total: 0, done: 0 };
    a.total += 1;
    if (s.status === "done") a.done += 1;
    byItem.set(s.item_id, a);
  }
  let procOpen = 0;
  for (const a of byItem.values()) if (a.done < a.total) procOpen += 1;

  const pillar = client.methodology_pillar as MethodologyPillar | null;
  const clinicRaw = (
    client as unknown as { clinic?: { name: string } | { name: string }[] | null }
  ).clinic;
  const clinicName =
    (Array.isArray(clinicRaw) ? clinicRaw[0] : clinicRaw)?.name ?? null;
  const isProgramMember =
    Boolean(client.empresarial_company_id) && client.empresarial_active !== false;
  const waLink = whatsappLink(
    client.phone,
    "Olá, {nome}! Aqui é da Risarte Odontologia, sobre o seu plano de tratamento. 😁",
    client.full_name
  );

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-6">
      {/* Cabeçalho — identidade do cliente + unidade + consultor. */}
      <div className="relative overflow-hidden rounded-xl border bg-card">
        <div
          className="h-1 w-full"
          style={{ backgroundColor: PHASE_COLORS[phase] }}
          aria-hidden
        />
        <RisarteMark className="pointer-events-none absolute top-2 -right-4 h-24 text-gold/10" />
        <div className="relative flex flex-wrap items-start justify-between gap-x-4 gap-y-3 p-4 sm:p-5">
          <div className="flex min-w-0 items-start gap-3 sm:gap-4">
            <div
              className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary text-base font-semibold text-gold"
              aria-hidden
            >
              {initialsOf(client.full_name)}
            </div>
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Briefcase className="size-3.5" />
                Cockpit do Consultor Comercial
              </p>
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
                {client.full_name}
              </h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {client.code && (
                  <span className="rounded-md bg-gold/15 px-2 py-0.5 font-mono text-xs font-medium text-gold-foreground">
                    {client.code}
                  </span>
                )}
                {clinicName && (
                  <span className="text-xs text-muted-foreground">
                    Unidade: {clinicName}
                  </span>
                )}
                <PhaseBadge phase={phase} showNumber />
                <Badge className="bg-gold text-gold-foreground">
                  {pillar ? PILLAR_LABELS[pillar] : "Pilar a definir"}
                </Badge>
                {isProgramMember && (
                  <Badge className="bg-gold/20 text-gold-foreground">
                    ★ Risarte Empresarial
                  </Badge>
                )}
                {consultantName && (
                  <span className="text-xs text-muted-foreground">
                    Consultor: {consultantName}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {waLink && (
              <Button
                size="sm"
                className="bg-emerald-600 text-white hover:bg-emerald-700"
                nativeButton={false}
                render={<a href={waLink} target="_blank" rel="noreferrer" />}
              >
                <MessageCircle className="mr-1 size-3.5" />
                WhatsApp
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<Link href={`/apresentacao/${clientId}`} />}
            >
              <Presentation className="mr-1 size-3.5" />
              Apresentação do plano
            </Button>
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<Link href={`/prontuarios/${clientId}`} />}
            >
              <FileText className="mr-1 size-3.5" />
              Ficha completa
            </Button>
          </div>
        </div>
      </div>

      {!inCommercialPhase && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <TriangleAlert className="size-4 shrink-0" />
          O cliente não está na Conversão Comercial (Fase 4) — a negociação fica
          indisponível até o caso chegar ao Comercial.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Coluna esquerda: mesa de apresentação + situação do cliente. */}
        <div className="space-y-4">
          <PresentationWorkspace
            clientId={clientId}
            data={presentation}
            canEdit={canNegotiate}
          />

          {/* Planos do cliente com a situação de cada um. */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5 text-base">
                <Layers className="size-4" />
                Planos do cliente
              </CardTitle>
            </CardHeader>
            <CardContent>
              {plans.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhum plano de tratamento ainda.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {plans.map((p, i) => (
                    <li
                      key={p.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-sm"
                    >
                      <span className="min-w-0">
                        <span className="font-medium">
                          Plano {plans.length - i}
                        </span>{" "}
                        <span className="text-xs text-muted-foreground">
                          · {new Date(p.createdAt).toLocaleDateString("pt-BR")} ·{" "}
                          {p.options.find((o) => o.isPrimary)?.items.length ?? 0}{" "}
                          procedimento(s)
                        </span>
                      </span>
                      <span
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-[11px] font-medium",
                          PLAN_STAGE_STYLES[planStage(p)]
                        )}
                      >
                        {PLAN_STAGE_LABELS[planStage(p)]}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Pendências + financeiro. */}
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Pendências do cliente</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p>
                  <strong>{procOpen}</strong> procedimento(s) em aberto
                </p>
                <p className={cn(qcRevisao > 0 && "text-amber-700")}>
                  <strong>{qcRevisao}</strong> em revisão (qualidade)
                </p>
                <p className={cn(qcReprovado > 0 && "text-rose-700")}>
                  <strong>{qcReprovado}</strong> reprovado(s) (qualidade)
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5 text-sm">
                  <Wallet className="size-4" />
                  Situação financeira
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                <p className="font-medium">Em breve</p>
                <p className="text-xs">
                  Em aberto × pago chega com a integração ASAAS (módulo
                  Financeiro).
                </p>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Coluna direita: negociação (só na Fase 4). */}
        <div className="space-y-4">
          {negotiationBlock ? (
            <NegotiationPanel
              clientId={clientId}
              planId={negotiationBlock.planId}
              options={negotiationBlock.options}
              negotiation={negotiationBlock.negotiation}
              rule={negotiationBlock.rule}
              canEdit={canNegotiate}
              canAuthorize={canAuthorize}
            />
          ) : (
            inCommercialPhase && (
              <Card>
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  Nenhum plano aprovado com opções para negociar ainda.
                </CardContent>
              </Card>
            )
          )}
        </div>
      </div>
    </div>
  );
}
