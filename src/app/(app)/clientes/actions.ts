"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { formatCep, formatCpf, formatPhone } from "@/lib/masks";

export type ActionResult = { ok: boolean; error?: string; clientId?: string };

function field(formData: FormData, name: string): string | null {
  return String(formData.get(name) ?? "").trim() || null;
}

function parseClientForm(formData: FormData) {
  const fullName = String(formData.get("full_name") ?? "").trim();
  if (!fullName) return { error: "Informe o nome completo." as const };

  const cpf = field(formData, "cpf");
  const phone = field(formData, "phone");
  const zipCode = field(formData, "zip_code");

  return {
    values: {
      full_name: fullName,
      cpf: cpf ? formatCpf(cpf) : null,
      birth_date: field(formData, "birth_date"),
      phone: phone ? formatPhone(phone) : null,
      email: field(formData, "email"),
      address: field(formData, "address"),
      address_number: field(formData, "address_number"),
      complement: field(formData, "complement"),
      neighborhood: field(formData, "neighborhood"),
      city: field(formData, "city"),
      state: field(formData, "state")?.toUpperCase() ?? null,
      zip_code: zipCode ? formatCep(zipCode) : null,
      notes: field(formData, "notes"),
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
