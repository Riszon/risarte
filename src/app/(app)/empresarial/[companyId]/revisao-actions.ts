"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { canWorkOnCompanies, isProgramManager } from "@/lib/empresarial/access";
import { empresarialDb } from "@/lib/empresarial/db";
import {
  recusaDaRevisao,
  termosDoFormulario,
  type TermosDoContrato,
} from "@/lib/empresarial/revisao-do-contrato";

/**
 * REVISAR CONTRATO (1050; plano REVISAR-CONTRATO-PLANO.md). Quem grava é o
 * banco, pelas portas `*_contract_revision`: aqui só se lê o formulário e se
 * traduz a recusa. As regras do banco mandam (R1 trava, R2 aditivo, R6 só o
 * gestor aplica); as guardas abaixo são para a tela responder sem ir ao banco.
 */

type Resultado = { ok: boolean; error?: string; erros?: string[]; id?: string };

function revalidar(companyId: string, revisaoId?: string) {
  revalidatePath(`/empresarial/${companyId}`);
  if (revisaoId) revalidatePath(`/empresarial/${companyId}/revisao/${revisaoId}`);
}

export async function abrirRevisao(companyId: string, motivo: string): Promise<Resultado> {
  const session = await getSessionContext();
  if (!canWorkOnCompanies(session)) return { ok: false, error: "Você não tem permissão para isso." };
  const db = await empresarialDb();
  const { data, error } = await db.rpc("open_contract_revision", {
    p_company_id: companyId,
    p_reason: motivo,
  });
  if (error || typeof data !== "string") return { ok: false, error: recusaDaRevisao(error?.message) };
  await logAudit({ action: "create", entityType: "empresarial_contract_revision", entityId: data });
  revalidar(companyId, data);
  return { ok: true, id: data };
}

async function lerRevisao(revisaoId: string) {
  const db = await empresarialDb();
  return db
    .from("contract_revisions")
    .select("id, company_id, status, terms_before")
    .eq("id", revisaoId)
    .maybeSingle<{ id: string; company_id: string; status: string; terms_before: TermosDoContrato }>();
}

export async function salvarRevisao(revisaoId: string, formData: FormData): Promise<Resultado> {
  const session = await getSessionContext();
  if (!canWorkOnCompanies(session)) return { ok: false, error: "Você não tem permissão para isso." };
  const { data: rev, error: erroDaLeitura } = await lerRevisao(revisaoId);
  if (erroDaLeitura || !rev) return { ok: false, error: "Revisão não encontrada." };

  const campos: Record<string, string | string[]> = {};
  for (const k of new Set(formData.keys())) {
    const vs = formData.getAll(k).map(String);
    campos[k] = vs.length > 1 || k.startsWith("faixa_") || k === "payment_methods" ? vs : vs[0];
  }
  const lido = termosDoFormulario(rev.terms_before, campos);
  if (!lido.ok) return { ok: false, error: lido.erros[0], erros: lido.erros };
  const motivo = String(formData.get("reason") ?? "");

  const db = await empresarialDb();
  const { error } = await db.rpc("save_contract_revision", {
    p_id: revisaoId,
    p_terms: lido.termos,
    p_reason: motivo,
  });
  if (error) return { ok: false, error: recusaDaRevisao(error.message) };
  await logAudit({ action: "update", entityType: "empresarial_contract_revision", entityId: revisaoId });
  revalidar(rev.company_id, revisaoId);
  return { ok: true };
}

/** O aditivo já foi enviado ao Storage pelo navegador: registra e liga à revisão. */
export async function anexarAditivo(
  revisaoId: string,
  nomeDoArquivo: string,
  caminho: string
): Promise<Resultado> {
  const session = await getSessionContext();
  if (!canWorkOnCompanies(session)) return { ok: false, error: "Você não tem permissão para isso." };
  const { data: rev } = await lerRevisao(revisaoId);
  if (!rev) return { ok: false, error: "Revisão não encontrada." };
  // A regra do Storage exige a pasta da empresa.
  if (!caminho.startsWith(`${rev.company_id}/`)) return { ok: false, error: "Caminho de arquivo inválido." };

  const db = await empresarialDb();
  const { data: arquivo, error: erroDoArquivo } = await db
    .from("company_files")
    .insert({
      company_id: rev.company_id,
      file_type: "aditivo",
      file_name: nomeDoArquivo.slice(0, 255),
      storage_path: caminho,
      uploaded_by: session.userId,
    })
    .select("id")
    .single<{ id: string }>();
  if (erroDoArquivo || !arquivo) {
    console.error("anexarAditivo (arquivo):", erroDoArquivo?.message);
    return { ok: false, error: "Não foi possível registrar o arquivo." };
  }
  const { error } = await db.rpc("attach_contract_revision_document", {
    p_id: revisaoId,
    p_file_id: arquivo.id,
  });
  if (error) return { ok: false, error: recusaDaRevisao(error.message) };
  await logAudit({
    action: "update",
    entityType: "empresarial_contract_revision",
    entityId: revisaoId,
    details: { aditivo: arquivo.id },
  });
  revalidar(rev.company_id, revisaoId);
  return { ok: true };
}

export async function aplicarRevisao(revisaoId: string): Promise<Resultado> {
  const session = await getSessionContext();
  // R6: só o gestor do programa aplica (o banco confere de novo).
  if (!isProgramManager(session)) return { ok: false, error: "Só o gestor do programa aplica a revisão." };
  const { data: rev } = await lerRevisao(revisaoId);
  if (!rev) return { ok: false, error: "Revisão não encontrada." };
  const db = await empresarialDb();
  const { error } = await db.rpc("apply_contract_revision", { p_id: revisaoId });
  if (error) return { ok: false, error: recusaDaRevisao(error.message) };
  await logAudit({ action: "update", entityType: "empresarial_contract_revision", entityId: revisaoId, details: { aplicada: true } });
  revalidar(rev.company_id, revisaoId);
  return { ok: true };
}

export async function cancelarRevisao(revisaoId: string, motivo: string): Promise<Resultado> {
  const session = await getSessionContext();
  if (!canWorkOnCompanies(session)) return { ok: false, error: "Você não tem permissão para isso." };
  const { data: rev } = await lerRevisao(revisaoId);
  if (!rev) return { ok: false, error: "Revisão não encontrada." };
  const db = await empresarialDb();
  const { error } = await db.rpc("cancel_contract_revision", { p_id: revisaoId, p_reason: motivo });
  if (error) return { ok: false, error: recusaDaRevisao(error.message) };
  await logAudit({ action: "update", entityType: "empresarial_contract_revision", entityId: revisaoId, details: { cancelada: true } });
  revalidar(rev.company_id, revisaoId);
  return { ok: true };
}
