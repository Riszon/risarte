"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";

export type ActionResult = { ok: boolean; error?: string; clientId?: string };

function parseClientForm(formData: FormData) {
  const fullName = String(formData.get("full_name") ?? "").trim();
  if (!fullName) return { error: "Informe o nome completo." as const };

  const birthDate = String(formData.get("birth_date") ?? "").trim();

  return {
    values: {
      full_name: fullName,
      cpf: String(formData.get("cpf") ?? "").trim() || null,
      birth_date: birthDate || null,
      phone: String(formData.get("phone") ?? "").trim() || null,
      email: String(formData.get("email") ?? "").trim() || null,
      address: String(formData.get("address") ?? "").trim() || null,
      city: String(formData.get("city") ?? "").trim() || null,
      state: String(formData.get("state") ?? "").trim() || null,
      zip_code: String(formData.get("zip_code") ?? "").trim() || null,
      notes: String(formData.get("notes") ?? "").trim() || null,
    },
  };
}

export async function createClientRecord(
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  const clinicId = session.activeClinic?.id;
  if (!clinicId) {
    return { ok: false, error: "Nenhuma clínica selecionada." };
  }
  if (!hasRoleInClinic(session, clinicId, ["receptionist"])) {
    return {
      ok: false,
      error: "Apenas a Recepção pode cadastrar clientes nesta clínica.",
    };
  }

  const parsed = parseClientForm(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .insert({
      ...parsed.values,
      clinic_id: clinicId,
      created_by: session.userId,
    })
    .select("id")
    .single();

  if (error) {
    console.error("createClientRecord failed:", error.message);
    return { ok: false, error: "Não foi possível cadastrar o cliente." };
  }

  await logAudit({
    action: "create",
    entityType: "client",
    entityId: data.id,
    clinicId,
  });
  revalidatePath("/clientes");
  return { ok: true, clientId: data.id };
}

export async function updateClientRecord(
  clientId: string,
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("clients")
    .select("clinic_id")
    .eq("id", clientId)
    .single();

  if (!existing) {
    return { ok: false, error: "Cliente não encontrado." };
  }
  if (!hasRoleInClinic(session, existing.clinic_id, ["receptionist"])) {
    return {
      ok: false,
      error: "Apenas a Recepção pode alterar dados de clientes.",
    };
  }

  const parsed = parseClientForm(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const { error } = await supabase
    .from("clients")
    .update(parsed.values)
    .eq("id", clientId);

  if (error) {
    console.error("updateClientRecord failed:", error.message);
    return { ok: false, error: "Não foi possível salvar as alterações." };
  }

  await logAudit({
    action: "update",
    entityType: "client",
    entityId: clientId,
    clinicId: existing.clinic_id,
  });
  revalidatePath("/clientes");
  revalidatePath(`/clientes/${clientId}`);
  return { ok: true, clientId };
}
