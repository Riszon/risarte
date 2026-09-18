"use server";

import { revalidatePath } from "next/cache";
import {
  fullAccessClinicIds,
  getSessionContext,
  hasRoleInClinic,
  requireAdminMaster,
  type SessionContext,
} from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { formatCep, formatCpf, formatPhone } from "@/lib/masks";
import { pedeEspecialidades } from "@/lib/risartanos";
import { isTreino } from "@/lib/environment";
import { SOMENTE_CONSULTA_NO_TREINO } from "@/lib/espelho";
import { agendarEspelho } from "@/lib/espelho-treino";
import {
  rolesForClinicType,
  type ClinicType,
  type UserRole,
} from "@/lib/roles";
import {
  CONTRACT_TYPES,
  GENDERS,
  MARITAL_STATUSES,
  STAFF_PHOTO_BUCKET,
} from "@/lib/staff";

/** H4.6 E1: salva os dias de atendimento do Risartano numa unidade (dias da
 * semana + datas específicas + nota). Admin ou Gerente/Franqueado da unidade. */
export async function saveStaffSchedule(input: {
  staffMemberId: string;
  clinicId: string;
  weekdays: number[];
  dates: string[];
  note: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (isTreino()) return { ok: false, error: SOMENTE_CONSULTA_NO_TREINO };
  const session = await getSessionContext();
  const canManage =
    session.isAdminMaster ||
    hasRoleInClinic(session, input.clinicId, ["unit_manager", "franchisee"]);
  if (!canManage) {
    return {
      ok: false,
      error: "Sem permissão para editar os dias de atendimento.",
    };
  }
  const weekdays = [...new Set(input.weekdays)]
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    .sort((a, b) => a - b);
  const dates = [...new Set(input.dates)]
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  const note = input.note.trim() || null;
  const supabase = await createClient();
  const { error } = await supabase.from("staff_clinic_schedule").upsert(
    {
      staff_member_id: input.staffMemberId,
      clinic_id: input.clinicId,
      weekdays,
      specific_dates: dates,
      note,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "staff_member_id,clinic_id" }
  );
  if (error) {
    console.error("saveStaffSchedule failed:", error.message);
    return {
      ok: false,
      error: "Não foi possível salvar os dias de atendimento.",
    };
  }
  await logAudit({
    action: "update",
    entityType: "staff_clinic_schedule",
    entityId: input.staffMemberId,
    clinicId: input.clinicId,
  });
  agendarEspelho({ risartano: input.staffMemberId });
  revalidatePath("/risartanos", "layout");
  return { ok: true };
}

export type ActionResult = { ok: boolean; error?: string };

/**
 * Cadastro devolve o id/unidade do novo Risartano p/ subir a foto em seguida —
 * e o CÓDIGO, que é o endereço da ficha para onde a tela leva quem cadastrou.
 */
export type CreateStaffResult = ActionResult & {
  staffId?: string;
  clinicId?: string;
  code?: string | null;
};

/**
 * Pode cadastrar/editar Risartano NESTA unidade: Admin Master; Gerente ou
 * Franqueado da unidade; ou Franqueadora/RH com acesso à unidade. (A edição de
 * um cadastro já existente — inclusive multi-unidade — usa `canManageStaff`.)
 */
async function canManage(
  session: SessionContext,
  clinicId: string
): Promise<boolean> {
  if (session.isAdminMaster) return true;
  if (hasRoleInClinic(session, clinicId, ["unit_manager", "franchisee"])) {
    return true;
  }
  const isFranchisorStaff = Object.values(session.rolesByClinic)
    .flat()
    .includes("franchisor_staff");
  if (!isFranchisorStaff) return false;
  const ids = await fullAccessClinicIds();
  return ids.includes(clinicId);
}

/** É Franqueadora/RH da rede (papel em qualquer clínica)? Pode escolher unidade. */
function isFranchisorStaff(session: SessionContext): boolean {
  return Object.values(session.rolesByClinic).flat().includes("franchisor_staff");
}

/**
 * Pode gerir ESTE cadastro (por id) — cobre o caso multi-unidade (Gerente de
 * uma unidade onde a pessoa tem acesso, mesmo que o cadastro seja de outra).
 * Espelha a função `can_manage_staff` da RLS.
 */
async function canManageStaff(staffId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("can_manage_staff", { p_staff_id: staffId });
  return data === true;
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

// Campos de texto obrigatórios (cadastro completo — o dono exige). Complemento,
// observações e cônjuge (condicional) ficam de fora. A FUNÇÃO é exigida logo
// abaixo, contra a lista de funções da clínica (não é texto livre).
const REQUIRED_TEXT: [string, string][] = [
  ["full_name", "Nome completo"],
  ["preferred_name", "Como quer ser chamado(a)"],
  ["birth_date", "Nascimento"],
  ["whatsapp", "WhatsApp"],
  ["email", "E-mail"],
  ["zip_code", "CEP"],
  ["address", "Logradouro"],
  ["address_number", "Número"],
  ["neighborhood", "Bairro"],
  ["city", "Cidade"],
  ["state", "UF"],
];

/** Que funções a clínica do cadastro aceita (a Franqueadora não tem recepção). */
async function funcoesDaClinica(clinicId: string): Promise<UserRole[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("clinics")
    .select("type")
    .eq("id", clinicId)
    .maybeSingle<{ type: ClinicType }>();
  return rolesForClinicType(data?.type ?? "franchise_unit");
}

function parseStaffForm(
  formData: FormData,
  funcoesPermitidas: readonly UserRole[]
):
  | { error: string }
  | { values: Record<string, unknown> } {
  for (const [name, label] of REQUIRED_TEXT) {
    if (!field(formData, name)) {
      return { error: `Preencha o campo obrigatório: ${label}.` };
    }
  }

  const cpf = field(formData, "cpf");
  if (!cpf || cpf.replace(/\D/g, "").length !== 11) {
    return { error: "Informe o CPF completo (11 dígitos)." };
  }

  const gender = oneOf(formData, "gender", GENDERS);
  if (!gender) return { error: "Selecione o gênero." };
  const maritalStatus = oneOf(formData, "marital_status", MARITAL_STATUSES);
  if (!maritalStatus) return { error: "Selecione o estado civil." };
  const contractType = oneOf(formData, "contract_type", CONTRACT_TYPES);
  if (!contractType) return { error: "Selecione o regime de contrato." };

  // A FUNÇÃO PREVISTA (`role_title`): dita o que a pessoa vem fazer e chega
  // pronta na hora de liberar o acesso. Quem decide o que ela ABRE continua
  // sendo `user_clinic_roles` — por isso a função é validada contra a mesma
  // lista que o acesso usa, e não contra texto livre.
  const roleTitle = oneOf(formData, "role_title", funcoesPermitidas);
  if (!roleTitle) {
    return { error: "Selecione a função desta pessoa na unidade." };
  }

  // Cônjuge só é exigido (e guardado) quando casado(a) ou união estável.
  const married =
    maritalStatus === "married" || maritalStatus === "stable_union";
  const spouseNameRaw = field(formData, "spouse_name");
  const spousePhoneRaw = field(formData, "spouse_phone");
  if (married && !spouseNameRaw) {
    return { error: "Informe o nome do cônjuge." };
  }

  // H4.5 Lote 3: especialidades marcadas (checkbox múltiplo). Sem obrigatório —
  // sem especialidade, a sugestão cai na continuidade/histórico.
  // Só dentista tem especialidade: quem deixou de ser dentista não pode
  // continuar sendo sugerido para uma sessão de Endodontia.
  const specialties = pedeEspecialidades(roleTitle)
    ? [
        ...new Set(
          formData
            .getAll("specialty")
            .map((s) => String(s).trim())
            .filter(Boolean)
        ),
      ]
    : [];

  return {
    values: {
      specialties,
      full_name: field(formData, "full_name"),
      preferred_name: field(formData, "preferred_name"),
      cpf: formatCpf(cpf),
      birth_date: field(formData, "birth_date"),
      gender,
      marital_status: maritalStatus,
      spouse_name: married ? spouseNameRaw : null,
      spouse_phone: married && spousePhoneRaw ? formatPhone(spousePhoneRaw) : null,
      whatsapp: formatPhone(field(formData, "whatsapp")!),
      email: field(formData, "email"),
      zip_code: formatCep(field(formData, "zip_code")!),
      address: field(formData, "address"),
      address_number: field(formData, "address_number"),
      complement: field(formData, "complement"),
      neighborhood: field(formData, "neighborhood"),
      city: field(formData, "city"),
      state: field(formData, "state")!.toUpperCase(),
      contract_type: contractType,
      role_title: roleTitle,
      notes: field(formData, "notes"),
    },
  };
}

export async function createStaffMember(
  formData: FormData
): Promise<CreateStaffResult> {
  if (isTreino()) return { ok: false, error: SOMENTE_CONSULTA_NO_TREINO };
  const session = await getSessionContext();

  // Admin e Franqueadora/RH escolhem a unidade; Gerente/Franqueado cadastram
  // SÓ na unidade ativa (a que estão logados).
  const canPickUnit = session.isAdminMaster || isFranchisorStaff(session);
  let clinicId: string;
  if (canPickUnit) {
    clinicId = String(formData.get("clinic_id") ?? "");
    if (!clinicId) return { ok: false, error: "Escolha a unidade." };
  } else {
    clinicId = session.activeClinic?.id ?? "";
    if (!clinicId) {
      return { ok: false, error: "Nenhuma unidade ativa selecionada." };
    }
  }
  if (!(await canManage(session, clinicId))) {
    return {
      ok: false,
      error: "Você só pode cadastrar Risartanos na sua unidade (como Gerente/Franqueado).",
    };
  }

  const parsed = parseStaffForm(formData, await funcoesDaClinica(clinicId));
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const supabase = await createClient();

  // Não criar dois Risartanos: se o CPF já existe na rede, bloqueia e aponta.
  const { data: dup } = await supabase.rpc("find_staff_by_cpf", {
    p_cpf: parsed.values.cpf as string,
  });
  if (dup && dup.length > 0) {
    const d = dup[0];
    return {
      ok: false,
      error: `Já existe um Risartano com este CPF: ${d.full_name} (unidade ${d.clinic_name}). Abra o cadastro dele em vez de criar outro.`,
    };
  }

  // "Completar cadastro" de um login que existe sem Risartano: o vínculo pelo
  // e-mail já acontece sozinho no banco (0079); este campo cobre o caso de o
  // e-mail do cadastro ser diferente do e-mail do login. Só o Admin vincula.
  const vincularUsuario = session.isAdminMaster
    ? String(formData.get("vincular_usuario") ?? "").trim()
    : "";

  const { data, error } = await supabase
    .from("staff_members")
    .insert({
      ...parsed.values,
      clinic_id: clinicId,
      created_by: session.userId,
      ...(vincularUsuario ? { user_id: vincularUsuario } : {}),
    })
    .select("id, code")
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
  agendarEspelho({ risartano: data.id });
  revalidatePath("/risartanos", "layout");
  return { ok: true, staffId: data.id, clinicId, code: data.code };
}

export async function updateStaffMember(
  staffId: string,
  formData: FormData
): Promise<ActionResult> {
  if (isTreino()) return { ok: false, error: SOMENTE_CONSULTA_NO_TREINO };
  const session = await getSessionContext();
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("staff_members")
    .select("*")
    .eq("id", staffId)
    .maybeSingle();
  if (!existing) return { ok: false, error: "Risartano não encontrado." };
  if (!(await canManageStaff(staffId))) {
    return { ok: false, error: "Você não tem permissão nesta unidade." };
  }
  const parsed = parseStaffForm(
    formData,
    await funcoesDaClinica(existing.clinic_id)
  );
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
  agendarEspelho({ risartano: staffId });
  revalidatePath("/risartanos", "layout");
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
  if (isTreino()) return { ok: false, error: SOMENTE_CONSULTA_NO_TREINO };
  const session = await getSessionContext();
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("staff_members")
    .select("clinic_id, photo_path")
    .eq("id", staffId)
    .maybeSingle();
  if (!existing) return { ok: false, error: "Risartano não encontrado." };
  if (!(await canManageStaff(staffId))) {
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
  agendarEspelho({ risartano: staffId });
  revalidatePath("/risartanos", "layout");
  return { ok: true };
}

/**
 * H4.1 Lote 2b: vincula o Risartano a um usuário de acesso (login). Só o Admin
 * gere acesso; o vínculo automático por e-mail acontece no banco (gatilhos).
 */
export async function linkStaffUser(
  staffId: string,
  userId: string
): Promise<ActionResult> {
  if (isTreino()) return { ok: false, error: SOMENTE_CONSULTA_NO_TREINO };
  await requireAdminMaster();
  if (!userId) return { ok: false, error: "Escolha o usuário." };
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("staff_members")
    .select("clinic_id")
    .eq("id", staffId)
    .maybeSingle();
  if (!existing) return { ok: false, error: "Risartano não encontrado." };

  const { error } = await supabase
    .from("staff_members")
    .update({ user_id: userId })
    .eq("id", staffId);
  if (error) {
    console.error("linkStaffUser failed:", error.message);
    return { ok: false, error: "Não foi possível vincular o usuário." };
  }
  await logAudit({
    action: "update",
    entityType: "staff_member",
    entityId: staffId,
    clinicId: existing.clinic_id,
    details: { access: "linked" },
  });
  agendarEspelho({ risartano: staffId });
  revalidatePath("/risartanos", "layout");
  return { ok: true };
}

/** H4.1 Lote 2b: desfaz o vínculo com o usuário de acesso (não apaga o login). */
export async function unlinkStaffUser(staffId: string): Promise<ActionResult> {
  if (isTreino()) return { ok: false, error: SOMENTE_CONSULTA_NO_TREINO };
  await requireAdminMaster();
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("staff_members")
    .select("clinic_id")
    .eq("id", staffId)
    .maybeSingle();
  if (!existing) return { ok: false, error: "Risartano não encontrado." };

  const { error } = await supabase
    .from("staff_members")
    .update({ user_id: null })
    .eq("id", staffId);
  if (error) {
    console.error("unlinkStaffUser failed:", error.message);
    return { ok: false, error: "Não foi possível desvincular." };
  }
  await logAudit({
    action: "update",
    entityType: "staff_member",
    entityId: staffId,
    clinicId: existing.clinic_id,
    details: { access: "unlinked" },
  });
  agendarEspelho({ risartano: staffId });
  revalidatePath("/risartanos", "layout");
  return { ok: true };
}

/**
 * H4.1: ativa/inativa o Risartano em UMA unidade específica, sem afetar as
 * outras. Só quem gere aquela unidade (Gerente/Franqueado/RH/Admin) altera.
 */
export async function setStaffUnitActive(
  staffId: string,
  clinicId: string,
  active: boolean
): Promise<ActionResult> {
  if (isTreino()) return { ok: false, error: SOMENTE_CONSULTA_NO_TREINO };
  const session = await getSessionContext();
  if (!clinicId) return { ok: false, error: "Unidade inválida." };
  if (!(await canManage(session, clinicId))) {
    return { ok: false, error: "Você só altera o status na sua unidade." };
  }
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("staff_members")
    .select("clinic_id, inactive_unit_ids")
    .eq("id", staffId)
    .maybeSingle();
  if (!existing) return { ok: false, error: "Risartano não encontrado." };

  const current: string[] = existing.inactive_unit_ids ?? [];
  const next = active
    ? current.filter((id) => id !== clinicId)
    : current.includes(clinicId)
      ? current
      : [...current, clinicId];

  const { error } = await supabase
    .from("staff_members")
    .update({
      inactive_unit_ids: next,
      updated_at: new Date().toISOString(),
      updated_by: session.userId,
    })
    .eq("id", staffId);
  if (error) {
    console.error("setStaffUnitActive failed:", error.message);
    return { ok: false, error: "Não foi possível atualizar o status." };
  }
  await logAudit({
    action: "update",
    entityType: "staff_member",
    entityId: staffId,
    clinicId,
    details: { unit_active: active },
  });
  agendarEspelho({ risartano: staffId });
  revalidatePath("/risartanos", "layout");
  return { ok: true };
}

export async function setStaffActive(
  staffId: string,
  active: boolean
): Promise<ActionResult> {
  if (isTreino()) return { ok: false, error: SOMENTE_CONSULTA_NO_TREINO };
  const session = await getSessionContext();
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("staff_members")
    .select("clinic_id")
    .eq("id", staffId)
    .maybeSingle();
  if (!existing) return { ok: false, error: "Risartano não encontrado." };
  if (!(await canManageStaff(staffId))) {
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
  agendarEspelho({ risartano: staffId });
  revalidatePath("/risartanos", "layout");
  return { ok: true };
}
