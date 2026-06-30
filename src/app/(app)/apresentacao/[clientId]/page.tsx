import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CLINICAL_BUCKET } from "@/lib/clinical";
import { PILLAR_LABELS, type MethodologyPillar } from "@/lib/journey";
import {
  budgetTotalCents,
  formatBRL,
  formatMinutes,
  formatSessions,
  type BudgetItem,
} from "@/lib/pricing";
import { PresentationView, type PresentationData } from "./presentation-view";

export const metadata: Metadata = { title: "Apresentação do plano" };

export default async function PresentationPage(
  props: PageProps<"/apresentacao/[clientId]">
) {
  const session = await getSessionContext();
  const { clientId } = await props.params;
  const supabase = await createClient();

  const { data: client } = await supabase
    .from("clients")
    .select(
      "id, full_name, code, clinic_id, journey_phase, methodology_pillar, clinic:clinics!clients_clinic_id_fkey ( name )"
    )
    .eq("id", clientId)
    .single();
  if (!client) notFound();

  // Quem monta/apresenta: Planner (constrói), Comercial (apresenta na Fase 4),
  // Coordenador/Gerente (leitura). Admin sempre.
  const isPlannerAnywhere = Object.values(session.rolesByClinic).some((roles) =>
    roles.includes("planner_dentist")
  );
  const canPresent =
    session.isAdminMaster ||
    isPlannerAnywhere ||
    hasRoleInClinic(session, client.clinic_id, [
      "commercial_consultant",
      "clinical_coordinator",
      "unit_manager",
    ]);
  if (!canPresent) redirect("/");

  // -- Plano aprovado: opção principal aprovada (ou a primeira aprovada) --
  const { data: planRows } = await supabase
    .from("treatment_plans")
    .select("id, status, diagnosis")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(1)
    .returns<{ id: string; status: string; diagnosis: string | null }[]>();
  const planRow = planRows?.[0];

  let diagnosis: string | null = null;
  let option: PresentationData["option"] = null;
  if (planRow) {
    diagnosis = planRow.diagnosis;
    const { data: optRows } = await supabase
      .from("treatment_plan_options")
      .select("id, is_primary, title, sort_order, review_status")
      .eq("plan_id", planRow.id)
      .eq("review_status", "approved")
      .order("is_primary", { ascending: false })
      .order("sort_order")
      .limit(1)
      .returns<
        {
          id: string;
          is_primary: boolean;
          title: string;
          sort_order: number;
          review_status: string;
        }[]
      >();
    const opt = optRows?.[0];
    if (opt) {
      const { data: itemRows } = await supabase
        .from("treatment_plan_option_items")
        .select(
          "id, procedure_id, description, quantity, unit_price_cents, planned_sessions, planned_total_minutes, sort_order"
        )
        .eq("option_id", opt.id)
        .order("sort_order")
        .returns<
          {
            id: string;
            procedure_id: string | null;
            description: string;
            quantity: number;
            unit_price_cents: number;
            planned_sessions: number | null;
            planned_total_minutes: number | null;
            sort_order: number;
          }[]
        >();
      const items: BudgetItem[] = (itemRows ?? []).map((it) => ({
        id: it.id,
        procedureId: it.procedure_id,
        description: it.description,
        quantity: it.quantity,
        unitPriceCents: it.unit_price_cents,
        plannedSessions: it.planned_sessions,
        plannedMinutes: it.planned_total_minutes,
      }));
      const totalSessions = items.reduce(
        (s, it) => s + (it.plannedSessions ?? 0),
        0
      );
      const totalMinutes = items.reduce(
        (s, it) => s + (it.plannedMinutes ?? 0),
        0
      );
      const summaryLabel =
        totalSessions > 0 || totalMinutes > 0
          ? [
              totalSessions > 0 ? formatSessions(totalSessions) : null,
              totalMinutes > 0 ? formatMinutes(totalMinutes) : null,
            ]
              .filter(Boolean)
              .join(" · ")
          : null;
      option = {
        title: opt.title,
        items: items.map((it) => ({
          description: it.description,
          quantity: it.quantity,
          sessionsLabel: it.plannedSessions
            ? formatSessions(it.plannedSessions)
            : null,
          minutesLabel: it.plannedMinutes
            ? formatMinutes(it.plannedMinutes)
            : null,
          priceLabel:
            it.unitPriceCents > 0
              ? formatBRL(it.unitPriceCents * it.quantity)
              : null,
        })),
        totalLabel:
          budgetTotalCents(items) > 0 ? formatBRL(budgetTotalCents(items)) : null,
        summaryLabel,
      };
    }
  }

  // -- Considerações clínicas (queixa/condição) --
  const { data: noteRows } = await supabase
    .from("clinical_notes")
    .select("body, created_at")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .returns<{ body: string; created_at: string }[]>();
  const considerations = (noteRows ?? [])
    .map((n) => n.body)
    .filter((b): b is string => Boolean(b && b.trim()))
    .slice(0, 6);

  // -- Imagens clínicas (somente imagens; URLs assinadas) --
  const { data: mediaRows } = await supabase
    .from("clinical_media")
    .select("id, original_name, storage_path, content_type, kind, created_at")
    .eq("client_id", clientId)
    .order("created_at", { ascending: true })
    .returns<
      {
        id: string;
        original_name: string | null;
        storage_path: string | null;
        content_type: string | null;
        kind: string;
        created_at: string;
      }[]
    >();
  const imageRows = (mediaRows ?? []).filter(
    (m) =>
      m.storage_path &&
      (m.content_type?.startsWith("image/") ||
        m.kind === "photo" ||
        m.kind === "radiograph" ||
        m.kind === "scan")
  );
  const photos = (
    await Promise.all(
      imageRows.map(async (m) => {
        const { data: signed } = await supabase.storage
          .from(CLINICAL_BUCKET)
          .createSignedUrl(m.storage_path as string, 3600);
        return signed?.signedUrl
          ? { id: m.id, url: signed.signedUrl, name: m.original_name }
          : null;
      })
    )
  ).filter((p): p is { id: string; url: string; name: string | null } =>
    Boolean(p)
  );

  const clinicRaw = (
    client as unknown as { clinic: { name: string } | { name: string }[] | null }
  ).clinic;
  const clinicName =
    (Array.isArray(clinicRaw) ? clinicRaw[0] : clinicRaw)?.name ?? null;

  const pillar = client.methodology_pillar as MethodologyPillar | null;

  const data: PresentationData = {
    clientName: client.full_name,
    clientCode: client.code,
    clinicName,
    pillarLabel: pillar ? PILLAR_LABELS[pillar] : null,
    dateLabel: new Date().toLocaleDateString("pt-BR"),
    diagnosis,
    considerations,
    photos,
    option,
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <PresentationView data={data} />
    </div>
  );
}
