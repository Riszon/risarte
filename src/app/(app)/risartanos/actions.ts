"use server";

import { revalidatePath } from "next/cache";
import {
  fullAccessClinicIds,
  getSessionContext,
  hasRoleInClinic,
  type SessionContext,
} from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { formatCep, formatCpf, formatPhone } from "@/lib/masks";
import {
  CONTRACT_TYPES,
  GENDERS,
  MARITAL_STATUSES,
  STAFF_PHOTO_BUCKET,
} from "@/lib/staff";

export type ActionResult = { ok: boolean; error?: string };

/** Cadastro devolve o id/unidade do novo Risartano p/ subir a foto em seguida. */
export type CreateStaffResult = ActionResult & {
  staffId?: string;
  clinicId?: string;
};

/** Admin Master, Gerente da unidade e Franqueadora (RH) com acesso à unidade. */
async function canManage(
  session: SessionContext,
  clinicId: string
): Promise<boolean> {
  if (session.isAdminMaster) return true;
  if (hasRoleInClinic(session, clinicId, ["unit_manager"])) return true;
  const isFranchisorStaff = Object.values(session.rolesByClinic)
    .flat()
    .includes("franchisor_staff");
  if (!isFranchisorStaff) return false;
  const ids = await fullAccessClinicIds();
  return ids.includes(clinicId);
}

function field(formData: FormData, key: string): string | null {
  const v = String(formData.get(key) ?? "").trim();
  return v || null;
}

function oneOf<T extends readonly string[]>(
  formData: FormData,
  key: string,
  allowed: T
): T[number] | null {
  const v = field(formData, key);
  return v && (allowed as readonly string[]).includes(v)
    ? (v as T[number])
    : null;
}

function parseStaffForm(formData: FormData):
  | { error: string }
  | { values: Record<string, unknown> } {
  const fullName = field(formData, "full_name");
  if (!fullName) return { error: "Informe o nome completo." };
  const cpf = field(formData, "cpf");
  return {
    values: {
      full_name: fullName,
      preferred_name: field(formData, "preferred_name"),
      cpf: cpf ? formatCpf(cpf) : null,
      birth_date: field(formData, "birth_date"),
      gender: oneOf(formData, "gender", GENDERS),
      marital_status: oneOf(formData, "marital_status", MARITAL_STATUSES),
      spouse_name: field(formData, "spouse_name"),
      spouse_phone: (() => {
        const p = field(formData, "spouse_phone");
        return p ? formatPhone(p) : null;
      })(),
      whatsapp: (() => {
        const w = field(formData, "whatsapp");
        return w ? formatPhone(w) : null;
      })(),
      email: field(formData, "email"),
      zip_code: (() => {
        const z = field(formData, "zip_code");
        return z ? formatCep(z) : null;
      })(),
      address: field(formData, "address"),
      address_number: field(formData, "address_number"),
      complement: field(formData, "complement"),
      neighborhood: field(formData, "neighborhood"),
      city: field(formData, "city"),
      state: field(formData, "state")?.toUpperCase() ?? null,
      contract_type: oneOf(formData, "contract_type", CONTRACT_TYPES),
      role_title: field(formData, "role_title"),
      notes: field(formData, "notes"),
    },
  };
}

export async function createStaffMember(
  formData: FormData
): Promise<CreateStaffResult> {
  const session = await getSessionContext();
  const clinicId = String(formData.get("clinic_id") ?? "");
  if (!clinicId) return { ok: false, error: "Escolha a unidade." };
  if (!(await canManage(session, clinicId))) {
    return { ok: false, error: "Você não tem permissão nesta unidade." };
  }
  const parsed = parseStaffForm(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("staff_members")
    .insert({ ...parsed.values, clinic_id: clinicId, created_by: session.userId })
    .select("id")
    .single();
  if (error) {
    console.error("createStaffMember failed:", error.message);
    return { ok: false, error: "Não foi possível cadastrar o Risartano." };
  }

  await logAudit({
    action: "create",
    entityType: "staff_member",
    entityId: data.id,
    clinicId,
  });
  revalidatePath("/risartanos");
  return { ok: true, staffId: data.id, clinicId };
}

export async function updateStaffMember(
  staffId: string,
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("staff_members")
    .select("*")
    .eq("id", staffId)
    .maybeSingle();
  if (!existing) return { ok: false, error: "Risartano não encontrado." };
  if (!(await canManage(session, existing.clinic_id))) {
    return { ok: false, error: "Você não tem permissão nesta unidade." };
  }
  const parsed = parseStaffForm(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  // Histórico: registra os campos que mudaram.
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [key, to] of Object.entries(parsed.values)) {
    const from = (existing as Record<string, unknown>)[key] ?? null;
    if ((from ?? null) !== (to ?? null)) changes[key] = { from: from ?? null, to };
  }

  const { error } = await supabase
    .from("staff_members")
    .update({ ...parsed.values, updated_at: new Date().toISOString(), updated_by: session.userId })
    .eq("id", staffId);
  if (error) {
    console.error("updateStaffMember failed:", error.message);
    return { ok: false, error: "Não foi possível salvar as alterações." };
  }

  if (Object.keys(changes).length > 0) {
    await supabase.from("staff_member_changes").insert({
      staff_member_id: staffId,
      changed_by: session.userId,
      fields: changes,
    });
  }
  await logAudit({
    action: "update",
    entityType: "staff_member",
    entityId: staffId,
    clinicId: existing.clinic_id,
  });
  revalidatePath("/risartanos");
  return { ok: true };
}

/**
 * H4.1 Lote 1b: salva o caminho da foto (o upload em si é feito no navegador
 * direto no Storage). Valida que o caminho pertence à unidade do colaborador e
 * remove a foto anterior. `path` vazio = remover a foto.
 */
export async function setStaffPhoto(
  staffId: string,
  path: string
): Promise<ActionResult> {
  const session = await getSessionContext();
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("staff_members")
    .select("clinic_id, photo_path")
    .eq("id", staffId)
    .maybeSingle();
  if (!existing) return { ok: false, error: "Risartano não encontrado." };
  if (!(await canManage(session, existing.clinic_id))) {
    return { ok: false, error: "Você não tem permissão nesta unidade." };
  }
  // A foto tem de estar na pasta da unidade do colaborador (<clinic_id>/...).
  const clean = path.trim();
  if (clean && !clean.startsWith(`${existing.clinic_id}/`)) {
    return { ok: false, error: "Caminho de foto inválido." };
  }

  const { error } = await supabase
    .from("staff_members")
    .update({
      photo_path: clean || null,
      updated_at: new Date().toISOString(),
      updated_by: session.userId,
    })
    .eq("id", staffId);
  if (error) {
    console.error("setStaffPhoto failed:", error.message);
    return { ok: false, error: "Não foi possível salvar a foto." };
  }

  // Remove a foto anterior (se trocou/removeu) — best-effort.
  if (existing.photo_path && existing.photo_path !== clean) {
    await supabase.storage
      .from(STAFF_PHOTO_BUCKET)
      .remove([existing.photo_path]);
  }
  await logAudit({
    action: "update",
    entityType: "staff_member",
    entityId: staffId,
    clinicId: existing.clinic_id,
    details: { photo: clean ? "set" : "removed" },
  });
  revalidatePath("/risartanos");
  return { ok: true };
}

export async function setStaffActive(
  staffId: string,
  active: boolean
): Promise<ActionResult> {
  const session = await getSessionContext();
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("staff_members")
    .select("clinic_id")
    .eq("id", staffId)
    .maybeSingle();
  if (!existing) return { ok: false, error: "Risartano não encontrado." };
  if (!(await canManage(session, existing.clinic_id))) {
    return { ok: false, error: "Você não tem permissão nesta unidade." };
  }

  const { error } = await supabase
    .from("staff_members")
    .update({
      is_active: active,
      updated_at: new Date().toISOString(),
      updated_by: session.userId,
    })
    .eq("id", staffId);
  if (error) {
    console.error("setStaffActive failed:", error.message);
    return { ok: false, error: "Não foi possível atualizar." };
  }
  await supabase.from("staff_member_changes").insert({
    staff_member_id: staffId,
    changed_by: session.userId,
    fields: { is_active: { to: active } },
  });
  await logAudit({
    action: "update",
    entityType: "staff_member",
    entityId: staffId,
    clinicId: existing.clinic_id,
    details: { active },
  });
  revalidatePath("/risartanos");
  return { ok: true };
}
