"use server";

import { revalidatePath } from "next/cache";
import { fullAccessClinicIds, getSessionContext } from "@/lib/auth";
import type { SessionContext } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { formatCpf, formatPhone } from "@/lib/masks";
import { createClient } from "@/lib/supabase/server";
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

/** I5b: dependentes vêm na 2ª aba da planilha, ligados pelo CPF do titular. */
export type DependentImportRow = {
  holderCpf: string;
  cpf: string;
  fullName?: string;
  relationship?: string;
  phone?: string;
};

export async function importEmployees(
  companyId: string,
  rows: EmployeeImportRow[],
  dependents: DependentImportRow[] = []
): Promise<ActionResult & {
  inserted?: number;
  errors?: number;
  dependentsInserted?: number;
}> {
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
  // I5b: dependentes da 2ª aba — ligados ao titular pelo CPF dele.
  let dependentsInserted = 0;
  const validDeps = dependents.filter(
    (d) =>
      (d.holderCpf ?? "").replace(/\D/g, "").length === 11 &&
      (d.cpf ?? "").replace(/\D/g, "").length === 11 &&
      (RELATIONSHIPS as readonly string[]).includes(d.relationship ?? "")
  );
  if (validDeps.length > 0) {
    const holderCpfs = [
      ...new Set(validDeps.map((d) => formatCpf(d.holderCpf))),
    ];
    const { data: holders } = await db
      .from("employees")
      .select("id, cpf")
      .eq("company_id", companyId)
      .in("cpf", holderCpfs);
    const idByCpf = new Map(
      ((holders ?? []) as { id: string; cpf: string }[]).map((h) => [
        h.cpf.replace(/\D/g, ""),
        h.id,
      ])
    );
    const depPayload = validDeps
      .map((d) => {
        const employeeId = idByCpf.get(d.holderCpf.replace(/\D/g, ""));
        if (!employeeId) return null;
        return {
          employee_id: employeeId,
          cpf: formatCpf(d.cpf),
          full_name: d.fullName?.trim() || null,
          phone: d.phone ? formatPhone(d.phone) : null,
          relationship: d.relationship,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    if (depPayload.length > 0) {
      const { error: depErr, count: depCount } = await db
        .from("dependents")
        .upsert(depPayload, {
          onConflict: "employee_id,cpf",
          ignoreDuplicates: true,
          count: "exact",
        });
      if (depErr) {
        console.error("importEmployees dependents failed:", depErr.message);
      } else {
        dependentsInserted = depCount ?? depPayload.length;
      }
    }
    errors += validDeps.length - depPayload.length;
  }
  errors += dependents.length - validDeps.length;

  await logAudit({
    action: "create",
    entityType: "empresarial_employee_import",
    entityId: companyId,
    details: { rows: payload.length, dependents: dependentsInserted },
  });
  revalidatePath(`/empresarial/${companyId}`);
  return {
    ok: true,
    inserted: count ?? payload.length,
    errors,
    dependentsInserted,
  };
}

/**
 * I5b: busca do cliente pelo CPF para AUTOPREENCHER o cadastro do colaborador
 * ou do dependente. Mesma ideia do cadastro do prontuário (H1.9) e do PPR+:
 * quem já é cliente da Risarte não é digitado de novo.
 */
export type EmpresarialCandidate = {
  found: boolean;
  clientId?: string;
  fullName?: string;
  phone?: string | null;
  email?: string | null;
  birthDate?: string | null;
  clinicName?: string | null;
  code?: string | null;
};

export async function lookupClientByCpf(
  cpf: string
): Promise<EmpresarialCandidate> {
  await getSessionContext();
  const formatted = formatCpf(cpf ?? "");
  if (formatted.replace(/\D/g, "").length !== 11) return { found: false };

  const supabase = await createClient();
  const { data: dup } = await supabase.rpc("find_duplicate_client", {
    p_cpf: formatted,
    p_full_name: "",
    p_birth_date: null,
  });
  const hit = (dup ?? [])[0] as
    | { client_id: string; clinic_name?: string }
    | undefined;
  if (!hit) return { found: false };

  const { data: client } = await supabase
    .from("clients")
    .select("id, code, full_name, phone, email, birth_date")
    .eq("id", hit.client_id)
    .maybeSingle<{
      id: string;
      code: string | null;
      full_name: string;
      phone: string | null;
      email: string | null;
      birth_date: string | null;
    }>();
  if (!client) return { found: false };

  return {
    found: true,
    clientId: client.id,
    code: client.code,
    fullName: client.full_name,
    phone: client.phone,
    email: client.email,
    birthDate: client.birth_date,
    clinicName: hit.clinic_name ?? null,
  };
}
