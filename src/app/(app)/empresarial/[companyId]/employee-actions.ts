"use server";

import { revalidatePath } from "next/cache";
import { fullAccessClinicIds, getSessionContext } from "@/lib/auth";
import type { SessionContext } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { formatCpf, formatPhone } from "@/lib/masks";
import { empresarialDb } from "@/lib/empresarial/db";
import { isProgramManager } from "@/lib/empresarial/access";
import {
  DEPENDENT_PLANS,
  LEFT_REASONS,
  RELATIONSHIPS,
} from "@/lib/empresarial/constants";

export type ActionResult = { ok: boolean; error?: string };

/** Pode mexer nos colaboradores: gestor do programa, SDR, recepção ou gestão da unidade. */
function canManageEmployees(session: SessionContext): boolean {
  if (isProgramManager(session)) return true;
  return Object.values(session.rolesByClinic)
    .flat()
    .some((r) =>
      ["sdr", "receptionist", "unit_manager", "franchisee"].includes(r)
    );
}

function field(formData: FormData, key: string): string | null {
  const v = String(formData.get(key) ?? "").trim();
  return v || null;
}

/**
 * Valida a unidade escolhida na "ponte". Admin, gestor do programa e SDR podem
 * registrar em qualquer unidade (regra do SDR — cliente pertence à unidade
 * escolhida); os demais só nas unidades do seu escopo.
 */
async function canUseClinic(
  session: SessionContext,
  clinicId: string
): Promise<boolean> {
  if (session.isAdminMaster || isProgramManager(session)) return true;
  const isSdr = Object.values(session.rolesByClinic).flat().includes("sdr");
  if (isSdr) return true;
  const scope = await fullAccessClinicIds();
  return scope.includes(clinicId);
}

export async function createEmployee(
  companyId: string,
  formData: FormData
): Promise<ActionResult & { employeeId?: string }> {
  const session = await getSessionContext();
  if (!canManageEmployees(session)) {
    return { ok: false, error: "Sem permissão para cadastrar colaboradores." };
  }
  const cpf = (field(formData, "cpf") ?? "").replace(/\D/g, "");
  if (cpf.length !== 11) return { ok: false, error: "Informe o CPF completo." };
  const fullName = field(formData, "full_name");
  if (!fullName) return { ok: false, error: "Informe o nome do colaborador." };
  const phone = field(formData, "phone");
  if (!phone) return { ok: false, error: "Informe o telefone." };
  const plan = field(formData, "dependent_plan") ?? "NONE";
  if (!(DEPENDENT_PLANS as readonly string[]).includes(plan)) {
    return { ok: false, error: "Plano de dependentes inválido." };
  }

  const db = await empresarialDb();
  const { data, error } = await db
    .from("employees")
    .insert({
      company_id: companyId,
      cpf: formatCpf(cpf),
      full_name: fullName,
      phone: formatPhone(phone),
      email: field(formData, "email"),
      dependent_plan: plan,
      grace_period_days: field(formData, "grace_period_days")
        ? Number.parseInt(field(formData, "grace_period_days")!, 10)
        : null,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "Este CPF já está cadastrado nesta empresa." };
    }
    console.error("createEmployee failed:", error.message);
    return { ok: false, error: "Não foi possível cadastrar o colaborador." };
  }
  await logAudit({
    action: "create",
    entityType: "empresarial_employee",
    entityId: data.id,
  });
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true, employeeId: data.id };
}

export async function updateEmployee(
  companyId: string,
  employeeId: string,
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canManageEmployees(session)) {
    return { ok: false, error: "Sem permissão." };
  }
  const fullName = field(formData, "full_name");
  if (!fullName) return { ok: false, error: "Informe o nome." };
  const phone = field(formData, "phone");
  const plan = field(formData, "dependent_plan") ?? "NONE";
  if (!(DEPENDENT_PLANS as readonly string[]).includes(plan)) {
    return { ok: false, error: "Plano de dependentes inválido." };
  }

  const db = await empresarialDb();
  const { error } = await db
    .from("employees")
    .update({
      full_name: fullName,
      phone: phone ? formatPhone(phone) : null,
      email: field(formData, "email"),
      dependent_plan: plan,
      grace_period_days: field(formData, "grace_period_days")
        ? Number.parseInt(field(formData, "grace_period_days")!, 10)
        : null,
    })
    .eq("id", employeeId);
  if (error) {
    console.error("updateEmployee failed:", error.message);
    return { ok: false, error: "Não foi possível salvar." };
  }
  await logAudit({
    action: "update",
    entityType: "empresarial_employee",
    entityId: employeeId,
  });
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}

/** Ponte: cria/vincula o cliente do riSZon e completa o cadastro. */
export async function completeEmployee(
  companyId: string,
  employeeId: string,
  clinicId: string
): Promise<ActionResult & { clientId?: string }> {
  const session = await getSessionContext();
  if (!canManageEmployees(session)) {
    return { ok: false, error: "Sem permissão." };
  }
  if (!clinicId) return { ok: false, error: "Escolha a unidade do colaborador." };
  if (!(await canUseClinic(session, clinicId))) {
    return { ok: false, error: "Você não pode registrar nesta unidade." };
  }

  const db = await empresarialDb();
  const { data, error } = await db.rpc("complete_employee", {
    p_employee_id: employeeId,
    p_clinic_id: clinicId,
  });
  if (error) {
    console.error("completeEmployee failed:", error.message);
    return { ok: false, error: "Não foi possível completar o cadastro." };
  }
  await logAudit({
    action: "update",
    entityType: "empresarial_employee",
    entityId: employeeId,
    clinicId,
    details: { linked_client: true },
  });
  revalidatePath(`/empresarial/${companyId}`);
  revalidatePath("/prontuarios");
  return { ok: true, clientId: (data as string) ?? undefined };
}

export async function setEmployeeStatus(
  companyId: string,
  employeeId: string,
  active: boolean,
  reason?: string
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canManageEmployees(session)) {
    return { ok: false, error: "Sem permissão." };
  }
  const validReason =
    reason && (LEFT_REASONS as readonly string[]).includes(reason)
      ? reason
      : null;
  const db = await empresarialDb();
  const { error } = await db.rpc("set_employee_active", {
    p_employee_id: employeeId,
    p_active: active,
    p_reason: validReason,
  });
  if (error) {
    console.error("setEmployeeStatus failed:", error.message);
    return { ok: false, error: "Não foi possível atualizar a situação." };
  }
  await logAudit({
    action: "update",
    entityType: "empresarial_employee",
    entityId: employeeId,
    details: { active },
  });
  revalidatePath(`/empresarial/${companyId}`);
  revalidatePath("/prontuarios");
  return { ok: true };
}

export async function addDependent(
  companyId: string,
  employeeId: string,
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canManageEmployees(session)) {
    return { ok: false, error: "Sem permissão." };
  }
  const cpf = (field(formData, "cpf") ?? "").replace(/\D/g, "");
  if (cpf.length !== 11) return { ok: false, error: "Informe o CPF do dependente." };
  const relationship = field(formData, "relationship") ?? "";
  if (!(RELATIONSHIPS as readonly string[]).includes(relationship)) {
    return { ok: false, error: "Selecione o grau de parentesco." };
  }

  const db = await empresarialDb();
  const { error } = await db.from("dependents").insert({
    employee_id: employeeId,
    cpf: formatCpf(cpf),
    full_name: field(formData, "full_name"),
    phone: field(formData, "phone") ? formatPhone(field(formData, "phone")!) : null,
    relationship,
  });
  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "Este CPF já é dependente deste colaborador." };
    }
    console.error("addDependent failed:", error.message);
    return { ok: false, error: "Não foi possível adicionar o dependente." };
  }
  await logAudit({
    action: "create",
    entityType: "empresarial_dependent",
    entityId: employeeId,
  });
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}

export async function linkDependent(
  companyId: string,
  dependentId: string,
  clinicId: string
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canManageEmployees(session)) {
    return { ok: false, error: "Sem permissão." };
  }
  if (!clinicId) return { ok: false, error: "Escolha a unidade." };
  if (!(await canUseClinic(session, clinicId))) {
    return { ok: false, error: "Você não pode registrar nesta unidade." };
  }
  const db = await empresarialDb();
  const { error } = await db.rpc("link_dependent", {
    p_dependent_id: dependentId,
    p_clinic_id: clinicId,
  });
  if (error) {
    console.error("linkDependent failed:", error.message);
    return { ok: false, error: "Não foi possível vincular o dependente." };
  }
  await logAudit({
    action: "update",
    entityType: "empresarial_dependent",
    entityId: dependentId,
    clinicId,
    details: { linked_client: true },
  });
  revalidatePath(`/empresarial/${companyId}`);
  revalidatePath("/prontuarios");
  return { ok: true };
}

export async function removeDependent(
  companyId: string,
  dependentId: string
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canManageEmployees(session)) {
    return { ok: false, error: "Sem permissão." };
  }
  const db = await empresarialDb();
  const { error } = await db.from("dependents").delete().eq("id", dependentId);
  if (error) {
    console.error("removeDependent failed:", error.message);
    return { ok: false, error: "Não foi possível remover." };
  }
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}

export type EmployeeImportRow = {
  cpf: string;
  fullName: string;
  phone: string;
  email: string;
  dependentPlan: string;
};

export async function importEmployees(
  companyId: string,
  rows: EmployeeImportRow[]
): Promise<ActionResult & { inserted?: number; errors?: number }> {
  const session = await getSessionContext();
  if (!canManageEmployees(session)) {
    return { ok: false, error: "Sem permissão." };
  }
  const db = await empresarialDb();

  const seen = new Set<string>();
  const payload: Record<string, unknown>[] = [];
  let errors = 0;
  for (const r of rows) {
    const cpf = (r.cpf ?? "").replace(/\D/g, "");
    if (cpf.length !== 11 || !r.fullName?.trim()) {
      errors++;
      continue;
    }
    if (seen.has(cpf)) continue;
    seen.add(cpf);
    const plan = (DEPENDENT_PLANS as readonly string[]).includes(r.dependentPlan)
      ? r.dependentPlan
      : "NONE";
    payload.push({
      company_id: companyId,
      cpf: formatCpf(cpf),
      full_name: r.fullName.trim(),
      phone: r.phone ? formatPhone(r.phone) : "",
      email: r.email?.trim() || null,
      dependent_plan: plan,
    });
  }
  if (payload.length === 0) {
    return { ok: false, error: "Nenhuma linha válida na planilha." };
  }

  // upsert por (company_id, cpf) — reimportar não duplica.
  const { error, count } = await db
    .from("employees")
    .upsert(payload, { onConflict: "company_id,cpf", ignoreDuplicates: true, count: "exact" });
  if (error) {
    console.error("importEmployees failed:", error.message);
    return { ok: false, error: "Não foi possível importar a planilha." };
  }
  await logAudit({
    action: "create",
    entityType: "empresarial_employee_import",
    entityId: companyId,
    details: { rows: payload.length },
  });
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true, inserted: count ?? payload.length, errors };
}
