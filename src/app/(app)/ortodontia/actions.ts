"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { parseBRLToCents } from "@/lib/pricing";
import { mensagemDaOrtodontia } from "@/lib/ortodontia/erros";
import {
  canManageOrtho,
  canSettleOrtho,
  canViewOrtho,
} from "@/lib/ortodontia/access";
import { ORTHO_KINDS, ORTHO_PAYMENT_METHODS, type OrthoKind } from "@/lib/ortodontia/constants";

export type OrthoActionResult = {
  ok: boolean;
  error?: string;
  caseId?: string;
  count?: number;
};

function refresh(caseId?: string, clientId?: string) {
  revalidatePath("/ortodontia");
  revalidatePath("/ortodontia/atencao");
  revalidatePath("/ortodontia/casos");
  revalidatePath("/ortodontia/mensalidades");
  if (caseId) revalidatePath(`/ortodontia/casos/${caseId}`);
  if (clientId) revalidatePath(`/prontuarios/${clientId}`);
}

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};
const int = (fd: FormData, k: string, fallback: number | null = null) => {
  const v = str(fd, k);
  if (v === "") return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
};
const cents = (fd: FormData, k: string) => {
  const v = str(fd, k);
  if (v === "") return 0;
  return parseBRLToCents(v) ?? 0;
};
const kind = (fd: FormData): OrthoKind => {
  const v = str(fd, "treatment_kind");
  return (ORTHO_KINDS as readonly string[]).includes(v) ? (v as OrthoKind) : "aparelho_fixo";
};
const dateOrNull = (fd: FormData, k: string) => {
  const v = str(fd, k);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
};
const uuidOrNull = (fd: FormData, k: string) => {
  const v = str(fd, k);
  return /^[0-9a-f-]{36}$/i.test(v) ? v : null;
};

// ---------------------------------------------------------------------------
// O caso
// ---------------------------------------------------------------------------

export async function createOrthoCase(formData: FormData): Promise<OrthoActionResult> {
  const session = await getSessionContext();
  const supabase = await createClient();
  const clientId = uuidOrNull(formData, "client_id");
  if (!clientId) return { ok: false, error: "Escolha o paciente." };

  const { data: client } = await supabase.from("clients").select("id, clinic_id").eq("id", clientId).maybeSingle();
  if (!client) return { ok: false, error: "Paciente não encontrado." };
  if (!canManageOrtho(session, client.clinic_id as string)) {
    return { ok: false, error: "Só o Gerente e o Coordenador da unidade abrem um caso de ortodontia." };
  }
  const months = int(formData, "planned_months", 24) ?? 24;
  if (months < 1 || months > 120) return { ok: false, error: "Meses previstos: entre 1 e 120." };
  const interval = int(formData, "maintenance_interval_days", 30) ?? 30;
  if (interval < 7 || interval > 180) return { ok: false, error: "Intervalo das manutenções: entre 7 e 180 dias." };
  const billing = int(formData, "billing_day", 10) ?? 10;
  if (billing < 1 || billing > 28) return { ok: false, error: "Dia de cobrança: entre 1 e 28." };

  const { data, error } = await supabase.rpc("ortho_create_case", {
    p_client_id: clientId,
    p_orthodontist_id: uuidOrNull(formData, "orthodontist_id"),
    p_treatment_kind: kind(formData),
    p_start_date: dateOrNull(formData, "start_date"),
    p_planned_months: months,
    p_interval_days: interval,
    p_monthly_fee_cents: cents(formData, "monthly_fee"),
    p_billing_day: billing,
    p_installation_fee_cents: cents(formData, "installation_fee"),
    p_maintenance_procedure_id: uuidOrNull(formData, "maintenance_procedure_id"),
    p_negotiation_id: uuidOrNull(formData, "negotiation_id"),
    p_notes: str(formData, "notes") || null,
    p_start_now: str(formData, "start_now") === "on",
  });
  if (error) return { ok: false, error: mensagemDaOrtodontia(error) };

  const caseId = data as string;
  await logAudit({ action: "create", entityType: "ortho_case", entityId: caseId, clinicId: client.clinic_id as string });
  refresh(caseId, clientId);
  return { ok: true, caseId };
}

export async function updateOrthoCase(caseId: string, formData: FormData): Promise<OrthoActionResult> {
  const session = await getSessionContext();
  const supabase = await createClient();
  const { data: c } = await supabase.from("ortho_cases").select("id, clinic_id, client_id").eq("id", caseId).maybeSingle();
  if (!c) return { ok: false, error: "Caso não encontrado." };
  if (!canManageOrtho(session, c.clinic_id as string)) return { ok: false, error: "Você não pode editar este caso." };

  const { error } = await supabase.rpc("ortho_update_case", {
    p_case_id: caseId,
    p_orthodontist_id: uuidOrNull(formData, "orthodontist_id"),
    p_treatment_kind: kind(formData),
    p_start_date: dateOrNull(formData, "start_date"),
    p_planned_months: int(formData, "planned_months"),
    p_interval_days: int(formData, "maintenance_interval_days"),
    p_monthly_fee_cents: cents(formData, "monthly_fee"),
    p_billing_day: int(formData, "billing_day"),
    p_installation_fee_cents: cents(formData, "installation_fee"),
    p_maintenance_procedure_id: uuidOrNull(formData, "maintenance_procedure_id"),
    p_next_reevaluation_date: dateOrNull(formData, "next_reevaluation_date"),
    p_notes: str(formData, "notes") || null,
  });
  if (error) return { ok: false, error: mensagemDaOrtodontia(error) };
  await logAudit({ action: "update", entityType: "ortho_case", entityId: caseId, clinicId: c.clinic_id as string });
  refresh(caseId, c.client_id as string);
  return { ok: true, caseId };
}

export async function setOrthoStatus(
  caseId: string,
  status: "em_tratamento" | "contencao" | "finalizado" | "interrompido",
  reason?: string,
  date?: string
): Promise<OrthoActionResult> {
  const session = await getSessionContext();
  const supabase = await createClient();
  const { data: c } = await supabase.from("ortho_cases").select("id, clinic_id, client_id").eq("id", caseId).maybeSingle();
  if (!c) return { ok: false, error: "Caso não encontrado." };
  if (!canManageOrtho(session, c.clinic_id as string)) return { ok: false, error: "Você não pode mudar a situação deste caso." };

  const { error } = await supabase.rpc("ortho_set_status", {
    p_case_id: caseId,
    p_status: status,
    p_reason: reason?.trim() || null,
    p_date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
  });
  if (error) return { ok: false, error: mensagemDaOrtodontia(error) };
  await logAudit({
    action: "update",
    entityType: "ortho_case",
    entityId: caseId,
    clinicId: c.clinic_id as string,
    details: { status },
  });
  refresh(caseId, c.client_id as string);
  return { ok: true, caseId };
}

// ---------------------------------------------------------------------------
// Manutenções
// ---------------------------------------------------------------------------

export async function saveOrthoEvolution(
  maintenanceId: string,
  input: { done: boolean; doneAt?: string | null; archWire?: string; notes?: string; nextSteps?: string }
): Promise<OrthoActionResult> {
  const session = await getSessionContext();
  if (!canViewOrtho(session)) return { ok: false, error: "Sem acesso à ortodontia." };
  const supabase = await createClient();
  const { data: m } = await supabase
    .from("ortho_maintenances")
    .select("id, case_id, clinic_id, client_id")
    .eq("id", maintenanceId)
    .maybeSingle();
  if (!m) return { ok: false, error: "Manutenção não encontrada." };

  const doneAt = input.doneAt && !Number.isNaN(Date.parse(input.doneAt)) ? new Date(input.doneAt).toISOString() : null;
  const { error } = await supabase.rpc("ortho_save_evolution", {
    p_maintenance_id: maintenanceId,
    p_done: input.done,
    p_done_at: doneAt,
    p_arch_wire: input.archWire?.trim() || null,
    p_notes: input.notes?.trim() || null,
    p_next_steps: input.nextSteps?.trim() || null,
  });
  if (error) return { ok: false, error: mensagemDaOrtodontia(error) };
  await logAudit({
    action: "update",
    entityType: "ortho_maintenance",
    entityId: maintenanceId,
    clinicId: m.clinic_id as string,
    details: { done: input.done },
  });
  refresh(m.case_id as string, m.client_id as string);
  return { ok: true, caseId: m.case_id as string };
}

export async function markOrthoMaintenance(
  maintenanceId: string,
  status: "faltou" | "cancelada" | "prevista"
): Promise<OrthoActionResult> {
  const session = await getSessionContext();
  if (!canViewOrtho(session)) return { ok: false, error: "Sem acesso à ortodontia." };
  const supabase = await createClient();
  const { data: m } = await supabase
    .from("ortho_maintenances")
    .select("id, case_id, clinic_id, client_id")
    .eq("id", maintenanceId)
    .maybeSingle();
  if (!m) return { ok: false, error: "Manutenção não encontrada." };
  const { error } = await supabase.rpc("ortho_mark_maintenance", { p_maintenance_id: maintenanceId, p_status: status });
  if (error) return { ok: false, error: mensagemDaOrtodontia(error) };
  await logAudit({
    action: "update",
    entityType: "ortho_maintenance",
    entityId: maintenanceId,
    clinicId: m.clinic_id as string,
    details: { status },
  });
  refresh(m.case_id as string, m.client_id as string);
  return { ok: true, caseId: m.case_id as string };
}

export async function addOrthoMaintenance(caseId: string, plannedDate: string): Promise<OrthoActionResult> {
  const session = await getSessionContext();
  if (!canViewOrtho(session)) return { ok: false, error: "Sem acesso à ortodontia." };
  const supabase = await createClient();
  const { data: c } = await supabase.from("ortho_cases").select("id, clinic_id, client_id").eq("id", caseId).maybeSingle();
  if (!c) return { ok: false, error: "Caso não encontrado." };
  const { data, error } = await supabase.rpc("ortho_add_maintenance", {
    p_case_id: caseId,
    p_planned_date: /^\d{4}-\d{2}-\d{2}$/.test(plannedDate) ? plannedDate : null,
  });
  if (error) return { ok: false, error: mensagemDaOrtodontia(error) };
  await logAudit({ action: "create", entityType: "ortho_maintenance", entityId: data as string, clinicId: c.clinic_id as string });
  refresh(caseId, c.client_id as string);
  return { ok: true, caseId };
}

export async function linkOrthoAppointment(maintenanceId: string, appointmentId: string): Promise<OrthoActionResult> {
  const session = await getSessionContext();
  if (!canViewOrtho(session)) return { ok: false, error: "Sem acesso à ortodontia." };
  const supabase = await createClient();
  const { data: m } = await supabase
    .from("ortho_maintenances")
    .select("id, case_id, clinic_id, client_id")
    .eq("id", maintenanceId)
    .maybeSingle();
  if (!m) return { ok: false, error: "Manutenção não encontrada." };
  const { error } = await supabase.rpc("ortho_link_appointment", {
    p_maintenance_id: maintenanceId,
    p_appointment_id: appointmentId,
  });
  if (error) return { ok: false, error: mensagemDaOrtodontia(error) };
  await logAudit({ action: "update", entityType: "ortho_maintenance", entityId: maintenanceId, clinicId: m.clinic_id as string });
  refresh(m.case_id as string, m.client_id as string);
  return { ok: true, caseId: m.case_id as string };
}

// ---------------------------------------------------------------------------
// Mensalidades
// ---------------------------------------------------------------------------

export async function generateOrthoCharges(clinicId: string, month?: string): Promise<OrthoActionResult> {
  const session = await getSessionContext();
  if (!canSettleOrtho(session, clinicId)) return { ok: false, error: "Você não pode gerar as mensalidades." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("ortho_generate_charges", {
    p_month: month && /^\d{4}-\d{2}-\d{2}$/.test(month) ? month : null,
    p_clinic_id: clinicId,
  });
  if (error) return { ok: false, error: mensagemDaOrtodontia(error) };
  // O banco devolve QUANTAS gerou (não é contagem de tela: erro já recusou acima).
  const geradas = typeof data === "number" ? data : 0;
  await logAudit({ action: "create", entityType: "ortho_charge", entityId: clinicId, clinicId, details: { geradas } });
  refresh();
  return { ok: true, count: geradas };
}

export async function markOrthoChargePaid(
  chargeId: string,
  paid: boolean,
  method?: string | null
): Promise<OrthoActionResult> {
  const session = await getSessionContext();
  const supabase = await createClient();
  const { data: ch } = await supabase
    .from("ortho_charges")
    .select("id, case_id, clinic_id, client_id")
    .eq("id", chargeId)
    .maybeSingle();
  if (!ch) return { ok: false, error: "Mensalidade não encontrada." };
  if (!canSettleOrtho(session, ch.clinic_id as string)) return { ok: false, error: "Você não pode dar baixa nesta mensalidade." };
  const m = method && (ORTHO_PAYMENT_METHODS as readonly string[]).includes(method) ? method : null;
  const { error } = await supabase.rpc("ortho_mark_charge_paid", {
    p_charge_id: chargeId,
    p_paid: paid,
    p_payment_method: m,
  });
  if (error) return { ok: false, error: mensagemDaOrtodontia(error) };
  await logAudit({
    action: "update",
    entityType: "ortho_charge",
    entityId: chargeId,
    clinicId: ch.clinic_id as string,
    details: { paid },
  });
  refresh(ch.case_id as string, ch.client_id as string);
  return { ok: true, caseId: ch.case_id as string };
}

export async function cancelOrthoCharge(chargeId: string, reason: string): Promise<OrthoActionResult> {
  const session = await getSessionContext();
  const supabase = await createClient();
  const { data: ch } = await supabase
    .from("ortho_charges")
    .select("id, case_id, clinic_id, client_id")
    .eq("id", chargeId)
    .maybeSingle();
  if (!ch) return { ok: false, error: "Mensalidade não encontrada." };
  if (!canManageOrtho(session, ch.clinic_id as string)) return { ok: false, error: "Só o Gerente e o Coordenador cancelam uma mensalidade." };
  if (reason.trim().length < 5) return { ok: false, error: "Escreva o motivo (pelo menos 5 letras)." };
  const { error } = await supabase.rpc("ortho_cancel_charge", { p_charge_id: chargeId, p_reason: reason.trim() });
  if (error) return { ok: false, error: mensagemDaOrtodontia(error) };
  await logAudit({ action: "update", entityType: "ortho_charge", entityId: chargeId, clinicId: ch.clinic_id as string, details: { cancelled: true } });
  refresh(ch.case_id as string, ch.client_id as string);
  return { ok: true, caseId: ch.case_id as string };
}

export async function refreshOrthoDelinquency(clinicId: string): Promise<OrthoActionResult> {
  const session = await getSessionContext();
  if (!canViewOrtho(session)) return { ok: false, error: "Sem acesso à ortodontia." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("ortho_refresh_delinquency", { p_clinic_id: clinicId });
  if (error) return { ok: false, error: mensagemDaOrtodontia(error) };
  const marcadas = typeof data === "number" ? data : 0;
  refresh();
  return { ok: true, count: marcadas };
}

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

export async function saveOrthoSettings(clinicId: string | null, formData: FormData): Promise<OrthoActionResult> {
  const session = await getSessionContext();
  if (clinicId === null && !session.isAdminMaster) {
    return { ok: false, error: "Só o Admin Master altera o padrão da rede." };
  }
  if (clinicId !== null && !(session.isAdminMaster || (session.rolesByClinic[clinicId] ?? []).includes("unit_manager"))) {
    return { ok: false, error: "Só o Gerente da unidade (ou o Admin) ajusta a unidade." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("ortho_save_settings", {
    p_clinic_id: clinicId,
    p_monthly_fee_cents: cents(formData, "monthly_fee"),
    p_planned_months: int(formData, "planned_months", 24),
    p_interval_days: int(formData, "maintenance_interval_days", 30),
    p_reevaluation_months: int(formData, "reevaluation_interval_months", 6),
    p_tolerance_days: int(formData, "finish_tolerance_days", 30),
    p_maintenance_procedure_id: uuidOrNull(formData, "maintenance_procedure_id"),
    p_billing_day: int(formData, "billing_day", 10),
  });
  if (error) return { ok: false, error: mensagemDaOrtodontia(error) };
  await logAudit({ action: "update", entityType: "ortho_settings", entityId: clinicId ?? "rede", clinicId: clinicId ?? undefined });
  revalidatePath("/ortodontia/configuracao");
  return { ok: true };
}
