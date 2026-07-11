"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import type { SessionContext } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { formatPhone } from "@/lib/masks";
import { empresarialDb } from "@/lib/empresarial/db";
import { isProgramManager, isRislifeConsultant } from "@/lib/empresarial/access";
import { LEAD_STAGES, type LeadStage } from "@/lib/empresarial/constants";

export type ActionResult = { ok: boolean; error?: string };

function canUseFunnel(session: SessionContext): boolean {
  return isProgramManager(session) || isRislifeConsultant(session);
}

function field(formData: FormData, key: string): string | null {
  const v = String(formData.get(key) ?? "").trim();
  return v || null;
}

function reaisToCents(value: string | null): number | null {
  if (!value) return null;
  const n = Number.parseFloat(
    value.replace(/\s/g, "").replace(/\./g, "").replace(",", ".")
  );
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export async function createLead(formData: FormData): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canUseFunnel(session)) return { ok: false, error: "Sem permissão." };
  const companyName = field(formData, "company_name");
  if (!companyName) return { ok: false, error: "Informe o nome da empresa." };

  // Consultor "puro" assume o próprio lead; gestor pode escolher.
  let consultantId = field(formData, "consultant_id");
  if (!consultantId && isRislifeConsultant(session) && !isProgramManager(session)) {
    consultantId = session.userId;
  }

  const db = await empresarialDb();
  const { data, error } = await db
    .from("commercial_leads")
    .insert({
      company_name: companyName,
      cnpj: (field(formData, "cnpj") ?? "").replace(/\D/g, "") || null,
      contact_name: field(formData, "contact_name"),
      contact_phone: field(formData, "contact_phone")
        ? formatPhone(field(formData, "contact_phone")!)
        : null,
      estimated_value_cents: reaisToCents(field(formData, "estimated_value")),
      next_action_at: field(formData, "next_action_at"),
      next_action_note: field(formData, "next_action_note"),
      notes: field(formData, "notes"),
      consultant_id: consultantId,
      stage: "CAPTURE",
    })
    .select("id")
    .single();
  if (error) {
    console.error("createLead failed:", error.message);
    return { ok: false, error: "Não foi possível criar o lead." };
  }
  await logAudit({
    action: "create",
    entityType: "empresarial_lead",
    entityId: data.id,
  });
  revalidatePath("/empresarial/funil");
  return { ok: true };
}

export async function updateLead(
  leadId: string,
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canUseFunnel(session)) return { ok: false, error: "Sem permissão." };
  const companyName = field(formData, "company_name");
  if (!companyName) return { ok: false, error: "Informe o nome da empresa." };

  const db = await empresarialDb();
  const { error } = await db
    .from("commercial_leads")
    .update({
      company_name: companyName,
      cnpj: (field(formData, "cnpj") ?? "").replace(/\D/g, "") || null,
      contact_name: field(formData, "contact_name"),
      contact_phone: field(formData, "contact_phone")
        ? formatPhone(field(formData, "contact_phone")!)
        : null,
      estimated_value_cents: reaisToCents(field(formData, "estimated_value")),
      next_action_at: field(formData, "next_action_at"),
      next_action_note: field(formData, "next_action_note"),
      notes: field(formData, "notes"),
    })
    .eq("id", leadId);
  if (error) {
    console.error("updateLead failed:", error.message);
    return { ok: false, error: "Não foi possível salvar." };
  }
  revalidatePath("/empresarial/funil");
  return { ok: true };
}

export async function moveLeadStage(
  leadId: string,
  stage: LeadStage,
  lostReason?: string
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canUseFunnel(session)) return { ok: false, error: "Sem permissão." };
  if (!(LEAD_STAGES as readonly string[]).includes(stage)) {
    return { ok: false, error: "Etapa inválida." };
  }
  const db = await empresarialDb();
  const patch: Record<string, unknown> = { stage };
  if (stage === "CLOSED_LOST") patch.lost_reason = lostReason ?? null;
  const { error } = await db
    .from("commercial_leads")
    .update(patch)
    .eq("id", leadId);
  if (error) {
    console.error("moveLeadStage failed:", error.message);
    return { ok: false, error: "Não foi possível mover o lead." };
  }
  await db.from("commercial_lead_activities").insert({
    lead_id: leadId,
    author_id: session.userId,
    kind: "STAGE_CHANGE",
    note: `Movido para ${stage}${lostReason ? ` (${lostReason})` : ""}`,
  });
  revalidatePath("/empresarial/funil");
  return { ok: true };
}

export async function addLeadActivity(
  leadId: string,
  kind: string,
  note: string
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canUseFunnel(session)) return { ok: false, error: "Sem permissão." };
  if (!note.trim()) return { ok: false, error: "Escreva a anotação." };
  const validKind = ["NOTE", "CALL", "MEETING", "PROPOSAL"].includes(kind)
    ? kind
    : "NOTE";
  const db = await empresarialDb();
  const { error } = await db.from("commercial_lead_activities").insert({
    lead_id: leadId,
    author_id: session.userId,
    kind: validKind,
    note: note.trim(),
  });
  if (error) {
    console.error("addLeadActivity failed:", error.message);
    return { ok: false, error: "Não foi possível registrar." };
  }
  revalidatePath("/empresarial/funil");
  return { ok: true };
}

/** Fecha o lead (ganho) criando a empresa a partir dos dados do lead. */
export async function convertLeadToCompany(
  leadId: string
): Promise<ActionResult & { companyId?: string }> {
  const session = await getSessionContext();
  if (!canUseFunnel(session)) return { ok: false, error: "Sem permissão." };
  const db = await empresarialDb();

  const { data: lead } = await db
    .from("commercial_leads")
    .select("company_name, cnpj, consultant_id, company_id")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) return { ok: false, error: "Lead não encontrado." };
  if (lead.company_id) {
    return { ok: false, error: "Este lead já virou empresa." };
  }
  const cnpj = (lead.cnpj ?? "").replace(/\D/g, "");
  if (cnpj.length !== 14) {
    return {
      ok: false,
      error: "Preencha um CNPJ válido no lead antes de fechar (14 dígitos).",
    };
  }

  const { data: company, error: cErr } = await db
    .from("companies")
    .insert({
      cnpj,
      legal_name: lead.company_name,
      trade_name: lead.company_name,
      payment_model: "EMPLOYEE_PAYS",
      status: "ACTIVE",
      assigned_consultant_id: lead.consultant_id,
    })
    .select("id")
    .single();
  if (cErr) {
    if (cErr.code === "23505") {
      return { ok: false, error: "Já existe uma empresa com este CNPJ." };
    }
    console.error("convertLeadToCompany failed:", cErr.message);
    return { ok: false, error: "Não foi possível criar a empresa." };
  }

  await db
    .from("commercial_leads")
    .update({ stage: "CLOSED_WON", company_id: company.id })
    .eq("id", leadId);
  await db.from("commercial_lead_activities").insert({
    lead_id: leadId,
    author_id: session.userId,
    kind: "STAGE_CHANGE",
    note: "Fechado (ganho) — empresa criada.",
  });
  await logAudit({
    action: "create",
    entityType: "empresarial_company",
    entityId: company.id,
    details: { from_lead: leadId },
  });
  revalidatePath("/empresarial/funil");
  revalidatePath("/empresarial");
  return { ok: true, companyId: company.id };
}
