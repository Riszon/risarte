"use server";

import { revalidatePath } from "next/cache";
import { requireAdminMaster } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import {
  USER_ROLES,
  UNIT_SCOPES,
  FRANCHISOR_ROLES,
  isRoleAllowedForClinicType,
  ROLE_LABELS,
  type ClinicType,
  type UnitScope,
  type UserRole,
} from "@/lib/roles";

export type ActionResult = { ok: boolean; error?: string };

/**
 * Persists the franchisor unit-access scope for a role assignment (the row in
 * user_clinic_roles). For 'specific', stores the chosen units; otherwise clears
 * them. No-op for non-franchisor roles.
 */
async function saveUnitScope(
  roleRowId: string,
  role: UserRole,
  scope: UnitScope | undefined,
  unitIds: string[] | undefined
): Promise<void> {
  if (!FRANCHISOR_ROLES.includes(role)) return;
  const effectiveScope: UnitScope = scope ?? "all";
  const supabase = await createClient();

  await supabase
    .from("user_clinic_roles")
    .update({ unit_scope: effectiveScope })
    .eq("id", roleRowId);

  await supabase.from("role_unit_access").delete().eq("user_clinic_role_id", roleRowId);

  if (effectiveScope === "specific" && unitIds && unitIds.length > 0) {
    await supabase.from("role_unit_access").insert(
      unitIds.map((clinicId) => ({
        user_clinic_role_id: roleRowId,
        clinic_id: clinicId,
      }))
    );
  }
}

/**
 * Validates that each role is allowed for its clinic's type (franchisor vs
 * unit). Returns an error message, or null when all assignments are valid.
 */
async function validateRoleEnvironments(
  assignments: { clinicId: string; role: UserRole }[]
): Promise<string | null> {
  if (assignments.length === 0) return null;
  const supabase = await createClient();
  const clinicIds = [...new Set(assignments.map((a) => a.clinicId))];
  const { data: clinics } = await supabase
    .from("clinics")
    .select("id, type")
    .in("id", clinicIds);

  const typeById = new Map<string, ClinicType>(
    (clinics ?? []).map((c) => [c.id, c.type as ClinicType])
  );

  for (const a of assignments) {
    const type = typeById.get(a.clinicId);
    if (!type) return "Clínica não encontrada.";
    if (!isRoleAllowedForClinicType(a.role, type)) {
      return `A função "${ROLE_LABELS[a.role]}" não pode ser atribuída neste tipo de clínica.`;
    }
  }
  return null;
}

const SERVICE_KEY_HINT =
  "A chave service_role ainda não foi configurada no arquivo .env.local do servidor.";

function validatePassword(password: string): string | null {
  if (password.length < 6) {
    return "A senha deve ter no mínimo 6 caracteres.";
  }
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return "A senha deve conter letras e números.";
  }
  return null;
}

export type RoleAssignment = {
  clinicId: string;
  role: UserRole;
  unitScope?: UnitScope;
  unitIds?: string[];
};

function parseAssignments(raw: string): RoleAssignment[] | null {
  try {
    const parsed = JSON.parse(raw) as RoleAssignment[];
    if (!Array.isArray(parsed)) return null;
    const seenClinics = new Set<string>();
    for (const item of parsed) {
      if (!item.clinicId || !USER_ROLES.includes(item.role)) return null;
      if (item.unitScope && !UNIT_SCOPES.includes(item.unitScope)) return null;
      // One role per clinic.
      if (seenClinics.has(item.clinicId)) return null;
      seenClinics.add(item.clinicId);
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function createUser(formData: FormData): Promise<ActionResult> {
  await requireAdminMaster();

  const fullName = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const assignments = parseAssignments(
    String(formData.get("assignments") ?? "[]")
  );

  if (!fullName) return { ok: false, error: "Informe o nome completo." };
  if (!email.includes("@")) return { ok: false, error: "E-mail inválido." };
  const passwordError = validatePassword(password);
  if (passwordError) return { ok: false, error: passwordError };
  if (!assignments)
    return {
      ok: false,
      error:
        "Funções inválidas. Verifique se não há duas funções na mesma clínica.",
    };

  const envError = await validateRoleEnvironments(assignments);
  if (envError) return { ok: false, error: envError };

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, error: SERVICE_KEY_HINT };
  }

  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });

  if (createError || !created.user) {
    console.error("createUser failed:", createError?.message);
    const friendly = createError?.message?.includes("already")
      ? "Já existe um usuário com este e-mail."
      : "Não foi possível criar o usuário.";
    return { ok: false, error: friendly };
  }

  const supabase = await createClient();
  if (assignments.length > 0) {
    const { data: insertedRoles, error: rolesError } = await supabase
      .from("user_clinic_roles")
      .insert(
        assignments.map((a) => ({
          user_id: created.user!.id,
          clinic_id: a.clinicId,
          role: a.role,
        }))
      )
      .select("id, clinic_id");
    if (rolesError) {
      console.error("role assignment failed:", rolesError.message);
      return {
        ok: false,
        error:
          "Usuário criado, mas houve erro ao atribuir funções. Edite o usuário para atribuí-las.",
      };
    }
    // Save the unit-access scope for franchisor-role assignments.
    for (const a of assignments) {
      const row = (insertedRoles ?? []).find((r) => r.clinic_id === a.clinicId);
      if (row) await saveUnitScope(row.id, a.role, a.unitScope, a.unitIds);
    }
  }

  // H4.1 Lote 2b: acesso criado a partir de um Risartano → vincula o cadastro
  // de RH ao novo login (além do vínculo automático por e-mail no banco).
  const staffMemberId = String(formData.get("staff_member_id") ?? "").trim();
  if (staffMemberId) {
    const { error: linkError } = await supabase
      .from("staff_members")
      .update({ user_id: created.user.id })
      .eq("id", staffMemberId)
      .is("user_id", null);
    if (linkError) {
      console.error("staff link on createUser failed:", linkError.message);
    }
  }

  await logAudit({
    action: "create",
    entityType: "user",
    entityId: created.user.id,
  });
  revalidatePath("/admin/usuarios");
  revalidatePath("/risartanos");
  return { ok: true };
}

export async function updateUserName(
  userId: string,
  formData: FormData
): Promise<ActionResult> {
  await requireAdminMaster();
  const fullName = String(formData.get("full_name") ?? "").trim();
  if (!fullName) return { ok: false, error: "Informe o nome completo." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: fullName })
    .eq("id", userId);

  if (error) {
    console.error("updateUserName failed:", error.message);
    return { ok: false, error: "Não foi possível salvar o nome." };
  }

  await logAudit({ action: "update", entityType: "user", entityId: userId });
  revalidatePath("/admin/usuarios");
  return { ok: true };
}

export async function resetUserPassword(
  userId: string,
  formData: FormData
): Promise<ActionResult> {
  await requireAdminMaster();
  const password = String(formData.get("password") ?? "");
  const passwordError = validatePassword(password);
  if (passwordError) return { ok: false, error: passwordError };

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, error: SERVICE_KEY_HINT };
  }

  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  if (error) {
    console.error("resetUserPassword failed:", error.message);
    return { ok: false, error: "Não foi possível redefinir a senha." };
  }

  await logAudit({
    action: "update",
    entityType: "user",
    entityId: userId,
    details: { field: "password" },
  });
  return { ok: true };
}

export async function setUserActive(
  userId: string,
  active: boolean
): Promise<ActionResult> {
  const session = await requireAdminMaster();
  if (userId === session.userId) {
    return { ok: false, error: "Você não pode desativar a si mesmo." };
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, error: SERVICE_KEY_HINT };
  }

  // Ban blocks login; ~100 years means "until reactivated".
  const { error: banError } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: active ? "none" : "876000h",
  });
  if (banError) {
    console.error("setUserActive ban failed:", banError.message);
    return { ok: false, error: "Não foi possível alterar o status." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ is_active: active })
    .eq("id", userId);
  if (error) {
    console.error("setUserActive flag failed:", error.message);
    return { ok: false, error: "Não foi possível alterar o status." };
  }

  await logAudit({
    action: "update",
    entityType: "user",
    entityId: userId,
    details: { field: "is_active", value: active },
  });
  revalidatePath("/admin/usuarios");
  return { ok: true };
}

export async function addUserRole(
  userId: string,
  clinicId: string,
  role: UserRole,
  unitScope?: UnitScope,
  unitIds?: string[]
): Promise<ActionResult> {
  await requireAdminMaster();
  if (!USER_ROLES.includes(role)) {
    return { ok: false, error: "Função inválida." };
  }

  const envError = await validateRoleEnvironments([{ clinicId, role }]);
  if (envError) return { ok: false, error: envError };

  const supabase = await createClient();
  const { data: inserted, error } = await supabase
    .from("user_clinic_roles")
    .insert({ user_id: userId, clinic_id: clinicId, role })
    .select("id")
    .single();

  if (error) {
    const friendly = error.code === "23505"
      ? "Este usuário já tem uma função nesta clínica. Remova a atual antes de adicionar outra."
      : "Não foi possível atribuir a função.";
    if (error.code !== "23505") {
      console.error("addUserRole failed:", error.message);
    }
    return { ok: false, error: friendly };
  }

  await saveUnitScope(inserted.id, role, unitScope, unitIds);

  await logAudit({
    action: "update",
    entityType: "user_clinic_roles",
    entityId: userId,
    clinicId,
    details: { added: role },
  });
  revalidatePath(`/admin/usuarios/${userId}`);
  revalidatePath("/admin/usuarios");
  return { ok: true };
}

/** Updates the unit-access scope of an existing franchisor role assignment. */
export async function updateRoleScope(
  roleRowId: string,
  userId: string,
  unitScope: UnitScope,
  unitIds: string[]
): Promise<ActionResult> {
  await requireAdminMaster();
  if (!UNIT_SCOPES.includes(unitScope)) {
    return { ok: false, error: "Escopo inválido." };
  }

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("user_clinic_roles")
    .select("role")
    .eq("id", roleRowId)
    .single();
  if (!row) return { ok: false, error: "Função não encontrada." };

  await saveUnitScope(roleRowId, row.role as UserRole, unitScope, unitIds);

  await logAudit({
    action: "update",
    entityType: "user_clinic_roles",
    entityId: userId,
    details: { unit_scope: unitScope, units: unitIds.length },
  });
  revalidatePath(`/admin/usuarios/${userId}`);
  return { ok: true };
}

export async function removeUserRole(
  roleRowId: string,
  userId: string
): Promise<ActionResult> {
  await requireAdminMaster();

  const supabase = await createClient();
  const { error } = await supabase
    .from("user_clinic_roles")
    .delete()
    .eq("id", roleRowId);

  if (error) {
    console.error("removeUserRole failed:", error.message);
    return { ok: false, error: "Não foi possível remover o papel." };
  }

  await logAudit({
    action: "update",
    entityType: "user_clinic_roles",
    entityId: userId,
    details: { removedRowId: roleRowId },
  });
  revalidatePath(`/admin/usuarios/${userId}`);
  revalidatePath("/admin/usuarios");
  return { ok: true };
}
