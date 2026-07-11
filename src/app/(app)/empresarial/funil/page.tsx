import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { empresarialDb } from "@/lib/empresarial/db";
import {
  canViewEmpresarial,
  isProgramManager,
  isRislifeConsultant,
} from "@/lib/empresarial/access";
import { Card, CardContent } from "@/components/ui/card";
import type { LeadStage } from "@/lib/empresarial/constants";
import { LeadBoard, type LeadView } from "./lead-board";

export const metadata: Metadata = { title: "Funil · Risarte Empresarial" };

type LeadRow = {
  id: string;
  company_name: string;
  cnpj: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  stage: LeadStage;
  consultant_id: string | null;
  lost_reason: string | null;
  company_id: string | null;
  estimated_value_cents: number | null;
  next_action_at: string | null;
  next_action_note: string | null;
  notes: string | null;
  updated_at: string;
};

export default async function FunilPage() {
  const session = await getSessionContext();
  if (!canViewEmpresarial(session)) redirect("/");
  const canUse = isProgramManager(session) || isRislifeConsultant(session);
  if (!canUse) redirect("/empresarial");

  const db = await empresarialDb();
  const { data: leadRows } = await db
    .from("commercial_leads")
    .select(
      "id, company_name, cnpj, contact_name, contact_phone, stage, consultant_id, lost_reason, company_id, estimated_value_cents, next_action_at, next_action_note, notes, updated_at"
    )
    .order("updated_at", { ascending: false })
    .returns<LeadRow[]>();
  const leads = leadRows ?? [];

  const leadIds = leads.map((l) => l.id);
  const { data: actRows } = leadIds.length
    ? await db
        .from("commercial_lead_activities")
        .select("id, lead_id, author_id, kind, note, created_at")
        .in("lead_id", leadIds)
        .order("created_at", { ascending: false })
        .returns<
          {
            id: string;
            lead_id: string;
            author_id: string | null;
            kind: string;
            note: string | null;
            created_at: string;
          }[]
        >()
    : { data: [] };

  // Nomes (consultores + autores de atividade).
  const userIds = [
    ...new Set(
      [
        ...leads.map((l) => l.consultant_id),
        ...(actRows ?? []).map((a) => a.author_id),
      ].filter((x): x is string => Boolean(x))
    ),
  ];
  const nameById = new Map<string, string>();
  if (userIds.length) {
    const supabase = await createClient();
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", userIds);
    for (const p of profs ?? [])
      nameById.set(p.id, p.full_name || p.email || "—");
  }

  const activitiesByLead = new Map<string, LeadView["activities"]>();
  for (const a of actRows ?? []) {
    const list = activitiesByLead.get(a.lead_id) ?? [];
    list.push({
      id: a.id,
      kind: a.kind,
      note: a.note,
      createdAt: a.created_at,
      authorName: a.author_id ? nameById.get(a.author_id) ?? null : null,
    });
    activitiesByLead.set(a.lead_id, list);
  }

  const leadViews: LeadView[] = leads.map((l) => ({
    id: l.id,
    companyName: l.company_name,
    cnpj: l.cnpj,
    contactName: l.contact_name,
    contactPhone: l.contact_phone,
    stage: l.stage,
    consultantId: l.consultant_id,
    consultantName: l.consultant_id ? nameById.get(l.consultant_id) ?? null : null,
    lostReason: l.lost_reason,
    companyId: l.company_id,
    estimatedValueCents: l.estimated_value_cents,
    nextActionAt: l.next_action_at,
    nextActionNote: l.next_action_note,
    notes: l.notes,
    activities: activitiesByLead.get(l.id) ?? [],
  }));

  // "Hoje do consultor": leads com próxima ação vencida/para hoje, ainda abertos.
  const endToday = new Date();
  endToday.setHours(23, 59, 59, 999);
  const todayLeads = leadViews.filter(
    (l) =>
      l.nextActionAt != null &&
      new Date(l.nextActionAt) <= endToday &&
      l.stage !== "CLOSED_WON" &&
      l.stage !== "CLOSED_LOST"
  );

  // Consultores (para o gestor atribuir).
  const supabase = await createClient();
  const { data: consultantRows } = await supabase
    .from("user_clinic_roles")
    .select("user_id, profiles ( full_name, email )")
    .eq("role", "rislife_consultant")
    .returns<
      { user_id: string; profiles: { full_name: string; email: string } | null }[]
    >();
  const consultantMap = new Map<string, string>();
  for (const c of consultantRows ?? [])
    consultantMap.set(c.user_id, c.profiles?.full_name || c.profiles?.email || "—");
  const consultants = [...consultantMap.entries()].map(([id, label]) => ({
    id,
    label,
  }));

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-8">
      <div>
        <Link
          href="/empresarial"
          className="text-xs text-muted-foreground hover:underline"
        >
          ← Empresas
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Funil comercial
        </h1>
        <p className="text-sm text-muted-foreground">
          Do primeiro contato ao fechamento. Ao fechar (ganho), a empresa é criada.
        </p>
      </div>

      {todayLeads.length > 0 && (
        <Card className="border-gold/40 bg-gold/5">
          <CardContent className="p-4">
            <p className="text-sm font-medium text-gold">
              ★ Hoje do consultor ({todayLeads.length})
            </p>
            <ul className="mt-2 space-y-1 text-sm">
              {todayLeads.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{l.companyName}</span>
                  <span className="text-xs text-muted-foreground">
                    {l.nextActionNote || "próxima ação"} ·{" "}
                    {new Date(l.nextActionAt!).toLocaleString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <LeadBoard
        leads={leadViews}
        consultants={consultants}
        canManage={isProgramManager(session)}
        currentUserId={session.userId}
      />
    </div>
  );
}
