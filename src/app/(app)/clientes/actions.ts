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
  /** Existing client's data, to autofill the form (when the viewer can read it). */
  birthDate?: string | null;
  phone?: string | null;
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

export type GuardianInput = {
  fullName: string;
  cpf: string | null;
  birthDate: string | null;
  relationship: string;
  phone: string | null;
  guardianClientId: string | null;
};

function isMinor(birthDate: string): boolean {
  const birth = new Date(`${birthDate}T00:00:00`);
  const age =
    (Date.now() - birth.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  return age < 18;
}

function parseGuardians(raw: string): GuardianInput[] | null {
  try {
    const parsed = JSON.parse(raw) as GuardianInput[];
    if (!Array.isArray(parsed)) return null;
    for (const g of parsed) {
      if (!g.fullName?.trim() || !g.relationship?.trim()) return null;
    }
    return parsed;
  } catch {
    return null;
  }
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

  // Owner rule: full registration is mandatory (complement is optional).
  const requiredFields: [string, string][] = [
    ["birth_date", "Data de nascimento"],
    ["phone", "Telefone/WhatsApp"],
    ["email", "E-mail"],
    ["address", "Endereço"],
    ["address_number", "Número"],
    ["neighborhood", "Bairro"],
    ["city", "Cidade"],
    ["state", "UF"],
    ["zip_code", "CEP"],
  ];
  for (const [name, label] of requiredFields) {
    if (!field(formData, name)) {
      return { error: `Preencha o campo obrigatório: ${label}.` as const };
    }
  }

  const birthDate = field(formData, "birth_date")!;
  const guardians = parseGuardians(String(formData.get("guardians") ?? "[]"));
  if (guardians === null) {
    return {
      error:
        "Dados do responsável incompletos: nome e parentesco são obrigatórios." as const,
    };
  }
  if (isMinor(birthDate) && guardians.length === 0) {
    return {
      error:
        "Cliente menor de 18 anos: informe ao menos um responsável." as const,
    };
  }

  const phone = field(formData, "phone");
  const zipCode = field(formData, "zip_code");

  return {
    values: {
      full_name: fullName,
      cpf: cpf && !noCpf ? formatCpf(cpf) : null,
      birth_date: birthDate,
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
    guardians,
  };
}

async function saveGuardians(
  clientId: string,
  guardians: GuardianInput[]
): Promise<void> {
  const supabase = await createClient();
  // Replace strategy: guardians are few; delete + reinsert keeps it simple.
  await supabase.from("client_guardians").delete().eq("client_id", clientId);
  if (guardians.length > 0) {
    const { error } = await supabase.from("client_guardians").insert(
      guardians.map((g) => ({
        client_id: clientId,
        guardian_client_id: g.guardianClientId,
        full_name: g.fullName.trim(),
        cpf: g.cpf ? formatCpf(g.cpf) : null,
        birth_date: g.birthDate || null,
        relationship: g.relationship.trim(),
        phone: g.phone ? formatPhone(g.phone) : null,
      }))
    );
    if (error) console.error("saveGuardians failed:", error.message);
  }
}

/** Autofill helper: is this CPF already a Risarte client? */
export async function lookupClientByCpf(cpf: string): Promise<{
  found: boolean;
  clientId?: string;
  fullName?: string;
  birthDate?: string | null;
  phone?: string | null;
}> {
  await getSessionContext();
  const formatted = formatCpf(cpf);
  if (formatted.replace(/\D/g, "").length !== 11) return { found: false };

  const supabase = await createClient();
  const { data } = await supabase.rpc("find_client_basic_by_cpf", {
    p_cpf: formatted,
  });
  if (!data || data.length === 0) return { found: false };
  return {
    found: true,
    clientId: data[0].client_id,
    fullName: data[0].full_name,
    birthDate: data[0].birth_date,
    phone: data[0].phone,
  };
}

/**
 * CPF-first registration: as soon as the CPF is typed, tell the form whether
 * it already belongs to a client (block + open/transfer) or to a "prospect"
 * (someone registered as a guardian, not yet a client → autofill the form).
 */
export async function lookupCpfForRegistration(cpf: string): Promise<{
  duplicate?: DuplicateInfo;
  prospect?: { fullName: string; birthDate: string | null; phone: string | null };
}> {
  const session = await getSessionContext();
  const clinicId = session.activeClinic?.id ?? null;
  const formatted = formatCpf(cpf);
  if (formatted.replace(/\D/g, "").length !== 11) return {};

  const supabase = await createClient();

  // 1) Already a client anywhere in the network? (CPF-only match.)
  const { data: duplicates } = await supabase.rpc("find_duplicate_client", {
    p_cpf: formatted,
    p_full_name: "",
    p_birth_date: null,
  });
  if (duplicates && duplicates.length > 0) {
    const dup = duplicates[0];
    // Pull the existing client's data to autofill the form (if RLS lets the
    // viewer read it — e.g. the SDR has access to that unit).
    const { data: existing } = await supabase
      .from("clients")
      .select("birth_date, phone")
      .eq("id", dup.client_id)
      .limit(1);
    return {
      duplicate: {
        clientId: dup.client_id,
        fullName: dup.full_name,
        clinicId: dup.clinic_id,
        clinicName: dup.clinic_name,
        matchType: dup.match_type as "cpf" | "name_birth",
        sameClinic: dup.clinic_id === clinicId,
        birthDate: existing?.[0]?.birth_date ?? null,
        phone: existing?.[0]?.phone ?? null,
      },
    };
  }

  // 2) A prospect (registered as a guardian, not yet a client)?
  const { data: prospect } = await supabase.rpc("find_prospect_by_cpf", {
    p_cpf: formatted,
  });
  if (prospect && prospect.length > 0) {
    return {
      prospect: {
        fullName: prospect[0].full_name,
        birthDate: prospect[0].birth_date,
        phone: prospect[0].phone,
      },
    };
  }

  return {};
}

export async function createClientRecord(
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  const activeClinicId = session.activeClinic?.id;
  if (!activeClinicId) {
    return { ok: false, error: "Nenhuma clínica selecionada." };
  }

  const isFranchisor = session.activeClinic?.type === "franchisor";
  const isSdr = Object.values(session.rolesByClinic).some((r) =>
    r.includes("sdr")
  );

  // Where the client is registered, and which clinic's prefix the code uses.
  let targetClinicId: string;
  let codeClinicId: string | null = null;
  if (isFranchisor) {
    // SDR (Encantador) registering from the Franqueadora: the client BELONGS to
    // the chosen unit, but the code keeps the Franqueadora prefix (FRA).
    if (!isSdr && !session.isAdminMaster) {
      return {
        ok: false,
        error: "Apenas o Encantador(a) (SDR) cadastra clientes na Franqueadora.",
      };
    }
    const chosen = String(formData.get("preferred_clinic_id") ?? "") || null;
    if (!chosen) return { ok: false, error: "Escolha a unidade do cliente." };
    targetClinicId = chosen;
    codeClinicId = activeClinicId; // Franqueadora → código FRA
  } else {
    if (!hasRoleInClinic(session, activeClinicId, ["receptionist"])) {
      return {
        ok: false,
        error: "Apenas a Recepção pode cadastrar clientes nesta unidade.",
      };
    }
    targetClinicId = activeClinicId;
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
        sameClinic: dup.clinic_id === targetClinicId,
      },
    };
  }

  // SDR registration keeps the Franqueadora code prefix (FRA-xxxxx). For the
  // unit's own reception, leave it null so the trigger uses the unit prefix.
  let code: string | null = null;
  if (codeClinicId) {
    const { data: codeData, error: codeErr } = await supabase.rpc(
      "next_client_code",
      { p_clinic_id: codeClinicId }
    );
    if (codeErr) console.error("next_client_code failed:", codeErr.message);
    else if (typeof codeData === "string") code = codeData;
  }

  const { data, error } = await supabase
    .from("clients")
    .insert({
      ...parsed.values,
      clinic_id: targetClinicId,
      preferred_clinic_id: null,
      code,
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

  await saveGuardians(data.id, parsed.guardians);

  await logAudit({
    action: "create",
    entityType: "client",
    entityId: data.id,
    clinicId: targetClinicId,
  });
  revalidatePath("/clientes");
  return { ok: true, clientId: data.id };
}

const CLIENT_FIELD_LABELS: Record<string, string> = {
  full_name: "Nome",
  cpf: "CPF",
  birth_date: "Nascimento",
  phone: "Telefone",
  email: "E-mail",
  address: "Endereço",
  address_number: "Número",
  complement: "Complemento",
  neighborhood: "Bairro",
  city: "Cidade",
  state: "UF",
  zip_code: "CEP",
  notes: "Observações",
};

export async function updateClientRecord(
  clientId: string,
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("clients")
    .select(
      "clinic_id, " + Object.keys(CLIENT_FIELD_LABELS).join(", ")
    )
    .eq("id", clientId)
    .single<Record<string, unknown> & { clinic_id: string }>();

  if (!existing) {
    return { ok: false, error: "Cliente não encontrado." };
  }

  // Reception of the unit, an SDR with access to it, or Admin may edit.
  const isSdr = Object.values(session.rolesByClinic).some((r) =>
    r.includes("sdr")
  );
  const canEdit =
    session.isAdminMaster ||
    hasRoleInClinic(session, existing.clinic_id, ["receptionist"]) ||
    isSdr; // RLS confirms the SDR actually has access to this unit
  if (!canEdit) {
    return {
      ok: false,
      error: "Apenas a Recepção ou Encantador(a) pode alterar dados de clientes.",
    };
  }

  const parsed = parseClientForm(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  // Which cadastral fields changed (labels only — LGPD: no values stored).
  const changedFields: string[] = [];
  for (const key of Object.keys(CLIENT_FIELD_LABELS)) {
    const oldVal = (existing[key] ?? "") as string;
    const newVal = ((parsed.values as Record<string, unknown>)[key] ?? "") as string;
    if (oldVal !== newVal) changedFields.push(CLIENT_FIELD_LABELS[key]);
  }

  const { error } = await supabase
    .from("clients")
    .update(parsed.values)
    .eq("id", clientId);

  if (error) {
    console.error("updateClientRecord failed:", error.message);
    return { ok: false, error: "Não foi possível salvar as alterações." };
  }

  await saveGuardians(clientId, parsed.guardians);

  if (changedFields.length > 0) {
    await supabase.from("client_changes").insert({
      client_id: clientId,
      clinic_id: existing.clinic_id,
      changed_by: session.userId,
      fields: changedFields.join(", "),
    });
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
 * Transfers a client to a specific unit (e.g. the SDR moves a client who
 * already belongs to unit A over to unit B). Requires consent. Never targets
 * the Franqueadora.
 */
export async function transferClientToUnit(
  clientId: string,
  targetClinicId: string,
  consentConfirmed: boolean
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!targetClinicId) return { ok: false, error: "Escolha a unidade de destino." };
  if (!consentConfirmed) {
    return {
      ok: false,
      error: "Confirme a autorização do cliente para a transferência.",
    };
  }
  const isSdr = Object.values(session.rolesByClinic).some((r) =>
    r.includes("sdr")
  );
  const allowed =
    session.isAdminMaster ||
    hasRoleInClinic(session, targetClinicId, ["receptionist"]) ||
    isSdr;
  if (!allowed) {
    return {
      ok: false,
      error: "Você não tem permissão para transferir o cliente para esta unidade.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("transfer_client", {
    p_client_id: clientId,
    p_target_clinic_id: targetClinicId,
    p_consent: true,
  });
  if (error) {
    if (error.message.includes("NOT_ALLOWED")) {
      return {
        ok: false,
        error: "Você não tem acesso a esta unidade para transferir o cliente.",
      };
    }
    if (error.message.includes("CONSENT_REQUIRED")) {
      return { ok: false, error: "Confirme a autorização do cliente." };
    }
    console.error("transfer_client (unit) failed:", error.message);
    return { ok: false, error: "Não foi possível transferir o cliente." };
  }
  revalidatePath("/clientes");
  revalidatePath(`/clientes/${clientId}`);
  return { ok: true, clientId };
}

/**
 * The active unit (B) pulls a client from another unit by CPF, sharing them
 * temporarily with B (E7.2). The home unit (A) keeps the client.
 */
export async function shareClientByCpf(
  cpf: string,
  reason: string
): Promise<{ ok: boolean; error?: string; clientId?: string }> {
  const session = await getSessionContext();
  const activeClinicId = session.activeClinic?.id;
  if (!activeClinicId || session.activeClinic?.type !== "franchise_unit") {
    return {
      ok: false,
      error: "Entre em uma unidade para compartilhar um cliente.",
    };
  }
  if (
    !session.isAdminMaster &&
    !hasRoleInClinic(session, activeClinicId, [
      "receptionist",
      "clinical_coordinator",
      "unit_manager",
    ])
  ) {
    return {
      ok: false,
      error: "Você não tem permissão para compartilhar nesta unidade.",
    };
  }
  const formatted = formatCpf(cpf);
  if (formatted.replace(/\D/g, "").length !== 11) {
    return { ok: false, error: "CPF incompleto: confira os 11 dígitos." };
  }

  const supabase = await createClient();
  const { data } = await supabase.rpc("find_client_basic_by_cpf", {
    p_cpf: formatted,
  });
  if (!data || data.length === 0) {
    return { ok: false, error: "Nenhum cliente encontrado com este CPF na rede." };
  }
  const clientId = data[0].client_id as string;

  const { error } = await supabase.rpc("share_client_with_unit", {
    p_client_id: clientId,
    p_target_clinic_id: activeClinicId,
    p_reason: reason || null,
  });
  if (error) {
    if (error.message.includes("SAME_CLINIC")) {
      return { ok: false, error: "Este cliente já é desta unidade." };
    }
    if (error.message.includes("NOT_ALLOWED")) {
      return {
        ok: false,
        error: "Você não tem permissão para compartilhar este cliente.",
      };
    }
    console.error("shareClientByCpf failed:", error.message);
    return { ok: false, error: "Não foi possível compartilhar o cliente." };
  }
  revalidatePath("/clientes");
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
  if (!hasRoleInClinic(session, clinicId, ["receptionist", "sdr"])) {
    return {
      ok: false,
      error:
        "Apenas a Recepção ou Encantador(a) pode receber clientes transferidos.",
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
