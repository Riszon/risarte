"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { formatCep, formatCpf, formatPhone } from "@/lib/masks";

export type DuplicateInfo = {
  clientId: string;
  fullName: string;
  clinicId: string;
  clinicName: string;
  matchType: "cpf" | "name_birth";
  sameClinic: boolean;
};

export type ActionResult = {
  ok: boolean;
  error?: string;
  clientId?: string;
  duplicate?: DuplicateInfo;
};

function field(formData: FormData, name: string): string | null {
  return String(formData.get(name) ?? "").trim() || null;
}

function parseClientForm(formData: FormData) {
  const fullName = String(formData.get("full_name") ?? "").trim();
  if (!fullName) return { error: "Informe o nome completo." as const };

  const cpf = field(formData, "cpf");
  // CPF is the network-wide unique identifier (owner decision). It may only
  // be omitted when the client has none (e.g. a child) — checkbox in the form.
  const noCpf = formData.get("no_cpf") === "true";
  if (!noCpf) {
    if (!cpf) return { error: "Informe o CPF (ou marque 'cliente sem CPF')." as const };
    if (cpf.replace(/\D/g, "").length !== 11) {
      return { error: "CPF incompleto: confira os 11 dígitos." as const };
    }
  }

  const phone = field(formData, "phone");
  const zipCode = field(formData, "zip_code");

  return {
    values: {
      full_name: fullName,
      cpf: cpf && !noCpf ? formatCpf(cpf) : null,
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

  // Network-wide duplicate check (clients are unique across the network).
  const { data: duplicates } = await supabase.rpc("find_duplicate_client", {
    p_cpf: parsed.values.cpf,
    p_full_name: parsed.values.full_name,
    p_birth_date: parsed.values.birth_date,
  });

  if (duplicates && duplicates.length > 0) {
    const dup = duplicates[0];
    return {
      ok: false,
      duplicate: {
        clientId: dup.client_id,
        fullName: dup.full_name,
        clinicId: dup.clinic_id,
        clinicName: dup.clinic_name,
        matchType: dup.match_type as "cpf" | "name_birth",
        sameClinic: dup.clinic_id === clinicId,
      },
    };
  }

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
    if (error.code === "23505") {
      return { ok: false, error: "Já existe um cliente com este CPF na rede." };
    }
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

/**
 * Transfers a client from another unit to the caller's active clinic.
 * Requires the client's registered consent (LGPD + original brief rule).
 */
export async function transferClientToActiveClinic(
  clientId: string,
  consentConfirmed: boolean
): Promise<ActionResult> {
  const session = await getSessionContext();
  const clinicId = session.activeClinic?.id;
  if (!clinicId) return { ok: false, error: "Nenhuma clínica selecionada." };
  if (session.activeClinic?.type === "franchisor") {
    return {
      ok: false,
      error: "A Franqueadora não atende clientes. Selecione uma unidade.",
    };
  }
  if (!consentConfirmed) {
    return {
      ok: false,
      error: "Confirme que o cliente autorizou a transferência.",
    };
  }
  if (!hasRoleInClinic(session, clinicId, ["receptionist"])) {
    return {
      ok: false,
      error: "Apenas a Recepção pode receber clientes transferidos.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("transfer_client", {
    p_client_id: clientId,
    p_target_clinic_id: clinicId,
    p_consent: true,
  });

  if (error) {
    console.error("transfer_client failed:", error.message);
    return { ok: false, error: "Não foi possível transferir o cliente." };
  }

  revalidatePath("/clientes");
  revalidatePath(`/clientes/${clientId}`);
  return { ok: true, clientId };
}
