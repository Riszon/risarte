"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import type { SessionContext } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { formatCpf } from "@/lib/masks";
import { empresarialDb } from "@/lib/empresarial/db";
import { isProgramManager } from "@/lib/empresarial/access";
import {
  COMPANY_DOCS_BUCKET,
  COMPANY_FILE_TYPES,
  DOC_TYPES,
  EMPLOYEE_DOCS_BUCKET,
  EMPLOYEE_FILE_TYPES,
  documentDigits,
  validateDocument,
  type DocType,
} from "@/lib/empresarial/documents";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: boolean; error?: string };

function field(formData: FormData, key: string): string | null {
  const v = String(formData.get(key) ?? "").trim();
  return v || null;
}

/** Documentos/arquivos da empresa: só quem gere o programa. */
function canManageCompany(session: SessionContext): boolean {
  return isProgramManager(session);
}

/** Arquivos do colaborador: programa + equipe da unidade (quem cadastra). */
function canManageEmployeeFiles(session: SessionContext): boolean {
  if (isProgramManager(session)) return true;
  return Object.values(session.rolesByClinic)
    .flat()
    .some((r) =>
      ["sdr", "receptionist", "unit_manager", "franchisee"].includes(r)
    );
}

// ---- Documentos da empresa --------------------------------------------------

export async function addCompanyDocument(
  companyId: string,
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canManageCompany(session)) return { ok: false, error: "Sem permissão." };

  const docType = (field(formData, "doc_type") ?? "") as DocType;
  if (!(DOC_TYPES as readonly string[]).includes(docType)) {
    return { ok: false, error: "Selecione o tipo de documento." };
  }
  const raw = field(formData, "doc_number") ?? "";
  const invalid = validateDocument(docType, raw);
  if (invalid) return { ok: false, error: invalid };

  const holderCpfRaw = field(formData, "holder_cpf");
  if (docType === "CAEPF") {
    if (!holderCpfRaw || holderCpfRaw.replace(/\D/g, "").length !== 11) {
      return { ok: false, error: "Informe o CPF do titular do CAEPF." };
    }
  }

  const db = await empresarialDb();
  // Primeiro documento da empresa entra como principal automaticamente.
  const { count } = await db
    .from("company_documents")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId);
  const makePrimary =
    (count ?? 0) === 0 || formData.get("is_primary") === "on";

  if (makePrimary) {
    // Um principal por empresa (índice único no banco garante).
    await db
      .from("company_documents")
      .update({ is_primary: false })
      .eq("company_id", companyId)
      .eq("is_primary", true);
  }

  const { error } = await db.from("company_documents").insert({
    company_id: companyId,
    doc_type: docType,
    doc_number: documentDigits(docType, raw),
    holder_cpf: docType === "CAEPF" ? formatCpf(holderCpfRaw!) : null,
    is_primary: makePrimary,
    nickname: field(formData, "nickname"),
  });
  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "Este documento já está cadastrado nesta empresa." };
    }
    console.error("addCompanyDocument failed:", error.message);
    return {
      ok: false,
      error: error.hint ?? "Não foi possível adicionar o documento.",
    };
  }

  await logAudit({
    action: "create",
    entityType: "empresarial_company_document",
    entityId: companyId,
    details: { doc_type: docType },
  });
  revalidatePath(`/empresarial/${companyId}`);
  revalidatePath("/empresarial");
  return { ok: true };
}

export async function updateCompanyDocument(
  companyId: string,
  documentId: string,
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canManageCompany(session)) return { ok: false, error: "Sem permissão." };

  const docType = (field(formData, "doc_type") ?? "") as DocType;
  if (!(DOC_TYPES as readonly string[]).includes(docType)) {
    return { ok: false, error: "Tipo de documento inválido." };
  }
  const raw = field(formData, "doc_number") ?? "";
  const invalid = validateDocument(docType, raw);
  if (invalid) return { ok: false, error: invalid };

  const holderCpfRaw = field(formData, "holder_cpf");
  if (docType === "CAEPF" && (!holderCpfRaw || holderCpfRaw.replace(/\D/g, "").length !== 11)) {
    return { ok: false, error: "Informe o CPF do titular do CAEPF." };
  }

  const db = await empresarialDb();
  const { error } = await db
    .from("company_documents")
    .update({
      doc_type: docType,
      doc_number: documentDigits(docType, raw),
      holder_cpf: docType === "CAEPF" ? formatCpf(holderCpfRaw!) : null,
      nickname: field(formData, "nickname"),
    })
    .eq("id", documentId);
  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "Este documento já está cadastrado nesta empresa." };
    }
    console.error("updateCompanyDocument failed:", error.message);
    return { ok: false, error: error.hint ?? "Não foi possível salvar." };
  }
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}

export async function setPrimaryDocument(
  companyId: string,
  documentId: string
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canManageCompany(session)) return { ok: false, error: "Sem permissão." };
  const db = await empresarialDb();

  // Tira o principal atual e promove o escolhido (o índice único não permite 2).
  await db
    .from("company_documents")
    .update({ is_primary: false })
    .eq("company_id", companyId)
    .eq("is_primary", true);
  const { error } = await db
    .from("company_documents")
    .update({ is_primary: true })
    .eq("id", documentId);
  if (error) {
    console.error("setPrimaryDocument failed:", error.message);
    return { ok: false, error: "Não foi possível definir como principal." };
  }
  await logAudit({
    action: "update",
    entityType: "empresarial_company_document",
    entityId: companyId,
    details: { primary: documentId },
  });
  revalidatePath(`/empresarial/${companyId}`);
  revalidatePath("/empresarial");
  return { ok: true };
}

export async function removeCompanyDocument(
  companyId: string,
  documentId: string
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canManageCompany(session)) return { ok: false, error: "Sem permissão." };
  const db = await empresarialDb();

  const { data: doc } = await db
    .from("company_documents")
    .select("is_primary")
    .eq("id", documentId)
    .maybeSingle<{ is_primary: boolean }>();
  if (doc?.is_primary) {
    return {
      ok: false,
      error:
        "Este é o documento principal. Marque outro como principal antes de remover.",
    };
  }
  const { count } = await db
    .from("employees")
    .select("id", { count: "exact", head: true })
    .eq("company_document_id", documentId);
  if ((count ?? 0) > 0) {
    return {
      ok: false,
      error: `${count} colaborador(es) estão vinculados a este documento. Mova-os antes de remover.`,
    };
  }

  const { error } = await db.from("company_documents").delete().eq("id", documentId);
  if (error) {
    console.error("removeCompanyDocument failed:", error.message);
    return { ok: false, error: "Não foi possível remover." };
  }
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}

/** Modelo de faturamento (só faz sentido com mais de um CNPJ). */
export async function setBillingModel(
  companyId: string,
  model: string
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canManageCompany(session)) return { ok: false, error: "Sem permissão." };
  if (model !== "unico" && model !== "por_cnpj") {
    return { ok: false, error: "Modelo inválido." };
  }
  const db = await empresarialDb();
  const { error } = await db
    .from("companies")
    .update({ billing_model: model })
    .eq("id", companyId);
  if (error) {
    console.error("setBillingModel failed:", error.message);
    return { ok: false, error: "Não foi possível salvar o modelo." };
  }
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}

/** Vincula o colaborador a um documento (CNPJ) da empresa. */
export async function setEmployeeDocument(
  companyId: string,
  employeeId: string,
  documentId: string | null
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canManageEmployeeFiles(session)) {
    return { ok: false, error: "Sem permissão." };
  }
  const db = await empresarialDb();
  const { error } = await db
    .from("employees")
    .update({ company_document_id: documentId })
    .eq("id", employeeId);
  if (error) {
    console.error("setEmployeeDocument failed:", error.message);
    return { ok: false, error: "Não foi possível vincular o CNPJ." };
  }
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}

// ---- Arquivos ---------------------------------------------------------------

/** Registra no banco um arquivo já enviado ao Storage pelo navegador. */
export async function registerCompanyFile(
  companyId: string,
  fileType: string,
  fileName: string,
  storagePath: string
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canManageCompany(session)) return { ok: false, error: "Sem permissão." };
  if (!(COMPANY_FILE_TYPES as readonly string[]).includes(fileType)) {
    return { ok: false, error: "Tipo de arquivo inválido." };
  }
  // O caminho tem de estar na pasta da empresa (a policy do Storage exige).
  if (!storagePath.startsWith(`${companyId}/`)) {
    return { ok: false, error: "Caminho de arquivo inválido." };
  }

  const db = await empresarialDb();
  const { error } = await db.from("company_files").insert({
    company_id: companyId,
    file_type: fileType,
    file_name: fileName.slice(0, 255),
    storage_path: storagePath,
    uploaded_by: session.userId,
  });
  if (error) {
    console.error("registerCompanyFile failed:", error.message);
    return { ok: false, error: "Não foi possível registrar o arquivo." };
  }
  await logAudit({
    action: "create",
    entityType: "empresarial_company_file",
    entityId: companyId,
    details: { file_type: fileType },
  });
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}

export async function deleteCompanyFile(
  companyId: string,
  fileId: string
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canManageCompany(session)) return { ok: false, error: "Sem permissão." };
  const db = await empresarialDb();
  const { data: file } = await db
    .from("company_files")
    .select("storage_path")
    .eq("id", fileId)
    .maybeSingle<{ storage_path: string }>();
  if (!file) return { ok: false, error: "Arquivo não encontrado." };

  const { error } = await db.from("company_files").delete().eq("id", fileId);
  if (error) {
    console.error("deleteCompanyFile failed:", error.message);
    return { ok: false, error: "Não foi possível excluir." };
  }
  const supabase = await createClient();
  await supabase.storage.from(COMPANY_DOCS_BUCKET).remove([file.storage_path]);

  await logAudit({
    action: "update",
    entityType: "empresarial_company_file",
    entityId: companyId,
    details: { deleted: true },
  });
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}

export async function registerEmployeeFile(
  companyId: string,
  employeeId: string,
  dependentId: string | null,
  fileType: string,
  fileName: string,
  storagePath: string
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canManageEmployeeFiles(session)) {
    return { ok: false, error: "Sem permissão." };
  }
  if (!(EMPLOYEE_FILE_TYPES as readonly string[]).includes(fileType)) {
    return { ok: false, error: "Tipo de arquivo inválido." };
  }
  if (!storagePath.startsWith(`${companyId}/`)) {
    return { ok: false, error: "Caminho de arquivo inválido." };
  }

  const db = await empresarialDb();
  const { error } = await db.from("employee_files").insert({
    employee_id: employeeId,
    dependent_id: dependentId,
    file_type: fileType,
    file_name: fileName.slice(0, 255),
    storage_path: storagePath,
    uploaded_by: session.userId,
  });
  if (error) {
    console.error("registerEmployeeFile failed:", error.message);
    return { ok: false, error: "Não foi possível registrar o arquivo." };
  }
  await logAudit({
    action: "create",
    entityType: "empresarial_employee_file",
    entityId: employeeId,
    details: { file_type: fileType, dependent: Boolean(dependentId) },
  });
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}

export async function deleteEmployeeFile(
  companyId: string,
  fileId: string
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canManageEmployeeFiles(session)) {
    return { ok: false, error: "Sem permissão." };
  }
  const db = await empresarialDb();
  const { data: file } = await db
    .from("employee_files")
    .select("storage_path")
    .eq("id", fileId)
    .maybeSingle<{ storage_path: string }>();
  if (!file) return { ok: false, error: "Arquivo não encontrado." };

  const { error } = await db.from("employee_files").delete().eq("id", fileId);
  if (error) {
    console.error("deleteEmployeeFile failed:", error.message);
    return { ok: false, error: "Não foi possível excluir." };
  }
  const supabase = await createClient();
  await supabase.storage.from(EMPLOYEE_DOCS_BUCKET).remove([file.storage_path]);
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}

/** URL assinada para baixar/ver um arquivo (LGPD: nunca link público). */
export async function getFileUrl(
  bucket: "company" | "employee",
  storagePath: string
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const session = await getSessionContext();
  if (!canManageEmployeeFiles(session) && !canManageCompany(session)) {
    return { ok: false, error: "Sem permissão." };
  }
  const supabase = await createClient();
  const bucketId =
    bucket === "company" ? COMPANY_DOCS_BUCKET : EMPLOYEE_DOCS_BUCKET;
  const { data, error } = await supabase.storage
    .from(bucketId)
    .createSignedUrl(storagePath, 300);
  if (error || !data?.signedUrl) {
    return { ok: false, error: "Não foi possível abrir o arquivo." };
  }
  return { ok: true, url: data.signedUrl };
}
