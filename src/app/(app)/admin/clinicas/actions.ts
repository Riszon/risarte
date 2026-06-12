"use server";

import { revalidatePath } from "next/cache";
import { requireAdminMaster } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { CLINIC_TYPES, type ClinicType } from "@/lib/roles";
import { formatCep, formatCnpj, formatPhone } from "@/lib/masks";

export type ActionResult = { ok: boolean; error?: string };

function field(formData: FormData, name: string): string | null {
  return String(formData.get(name) ?? "").trim() || null;
}

function parseClinicForm(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const type = String(formData.get("type") ?? "") as ClinicType;
  if (!name) return { error: "Informe o nome da clínica." as const };
  if (!CLINIC_TYPES.includes(type))
    return { error: "Tipo de clínica inválido." as const };

  const cnpj = field(formData, "cnpj");
  const phone = field(formData, "phone");
  const zipCode = field(formData, "zip_code");
  const code = field(formData, "code")?.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!code) {
    return { error: "Informe o código da unidade (ex.: CBE)." as const };
  }

  return {
    values: {
      name,
      type,
      code,
      cnpj: cnpj ? formatCnpj(cnpj) : null,
      phone: phone ? formatPhone(phone) : null,
      email: field(formData, "email"),
      address: field(formData, "address"),
      address_number: field(formData, "address_number"),
      complement: field(formData, "complement"),
      neighborhood: field(formData, "neighborhood"),
      city: field(formData, "city"),
      state: field(formData, "state")?.toUpperCase() ?? null,
      zip_code: zipCode ? formatCep(zipCode) : null,
      is_active: formData.get("is_active") !== "false",
    },
  };
}

export async function createClinic(formData: FormData): Promise<ActionResult> {
  await requireAdminMaster();
  const parsed = parseClinicForm(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clinics")
    .insert(parsed.values)
    .select("id")
    .single();

  if (error) {
    console.error("createClinic failed:", error.message);
    return { ok: false, error: "Não foi possível salvar a clínica." };
  }

  await logAudit({
    action: "create",
    entityType: "clinic",
    entityId: data.id,
    clinicId: data.id,
  });
  revalidatePath("/admin/clinicas");
  return { ok: true };
}

export async function updateClinic(
  clinicId: string,
  formData: FormData
): Promise<ActionResult> {
  await requireAdminMaster();
  const parsed = parseClinicForm(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("clinics")
    .update(parsed.values)
    .eq("id", clinicId);

  if (error) {
    console.error("updateClinic failed:", error.message);
    return { ok: false, error: "Não foi possível salvar as alterações." };
  }

  await logAudit({
    action: "update",
    entityType: "clinic",
    entityId: clinicId,
    clinicId,
  });
  revalidatePath("/admin/clinicas");
  return { ok: true };
}
