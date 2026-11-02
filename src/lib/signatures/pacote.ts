import "server-only";

import type { SessionContext } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { formatBrDate } from "@/lib/dates";
import { montarMensagem, primeiroNome } from "@/lib/notify/templates";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ZapsignError, isZapsignFake, mensagemDaZapsign, refuseDocument, refuseDocumentFake, resendNotifications } from "@/lib/zapsign";
import { canCancelSignatures, canDownloadSignatures, canSendSignatures, canViewSignaturePackages } from "./access";
import { gerarCopia, nomeDoArquivo } from "./pdf/copy";
import { BUCKET, qualificacao } from "./send";
import type { PackageStage, PackageStatus } from "./types";

/**
 * AS AÇÕES SOBRE UM PACOTE JÁ ENVIADO (ZS4): visualizar, baixar o assinado,
 * baixar a cópia de um documento, reenviar o link, reenviar pelo e-mail da
 * ZapSign e cancelar. Cada uma:
 *
 *   1. lê o pacote COM A SESSÃO de quem pediu (RLS: quem não vê, não acha);
 *   2. confere a permissão da tela (`access.ts`) na unidade emissora;
 *   3. passa pela porta do banco (0344) ou pelo bucket com a mesma sessão —
 *      a URL assinada só sai se a policy do Storage deixar;
 *   4. registra: `logAudit` (auditoria geral, só ids) + `signature_events`
 *      (`action:view`, `action:download`, `action:download_copy`,
 *      `action:resend`, `action:cancel`).
 *
 * As URLs valem 60 s: o bastante para o navegador abrir, curto para não
 * circular. Download sai com nome de arquivo; visualização, sem.
 */

const URL_SECONDS = 60;

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

type PackageRow = {
  id: string;
  number: string;
  clinic_id: string;
  status: PackageStatus;
  current_stage: PackageStage;
  audience: "patient" | "company";
  client_id: string | null;
  merged_pdf_path: string | null;
  signed_pdf_path: string | null;
  zapsign_doc_token: string | null;
  sent_at: string | null;
  expires_at: string | null;
};

const NAO_ENCONTRADO = "Pacote não encontrado, ou você não tem acesso a ele.";

async function lerPacote(packageId: string): Promise<PackageRow | null> {
  if (!packageId) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("signature_packages")
    .select("id, number, clinic_id, status, current_stage, audience, client_id, merged_pdf_path, signed_pdf_path, zapsign_doc_token, sent_at, expires_at")
    .eq("id", packageId)
    .maybeSingle<PackageRow>();
  return data ?? null;
}

async function registrar(pkg: PackageRow, action: "view" | "download" | "download_copy", payload: Record<string, unknown>) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("signature_log_action", { p_package_id: pkg.id, p_action: action, p_payload: payload });
  if (error) console.error("signature_log_action failed:", error.message);
  await logAudit({
    action: action === "view" ? "view" : "export",
    entityType: "signature_package",
    entityId: pkg.id,
    clinicId: pkg.clinic_id,
    details: { what: action, ...payload },
  });
}

async function urlAssinada(path: string, download?: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, URL_SECONDS, download ? { download } : undefined);
  if (error || !data) {
    console.error("signature signed url failed:", error?.message);
    return null;
  }
  return data.signedUrl;
}

/** O PDF para o visualizador: pendente → o enviado; assinado → o assinado (se já chegou). */
export async function abrirPdf(session: SessionContext, packageId: string): Promise<ActionResult<{ url: string; kind: "merged" | "signed" }>> {
  const pkg = await lerPacote(packageId);
  if (!pkg) return { ok: false, error: NAO_ENCONTRADO };
  if (!canViewSignaturePackages(session, pkg.clinic_id)) return { ok: false, error: "Você não tem permissão para visualizar documentos assinados." };
  const kind: "merged" | "signed" = pkg.status === "signed" && pkg.signed_pdf_path ? "signed" : "merged";
  const path = kind === "signed" ? pkg.signed_pdf_path : pkg.merged_pdf_path;
  if (!path) return { ok: false, error: "O PDF deste pacote ainda não foi gerado." };
  const url = await urlAssinada(path);
  if (!url) return { ok: false, error: "Não foi possível abrir o PDF agora. Tente de novo em instantes." };
  await registrar(pkg, "view", { file: kind });
  return { ok: true, url, kind };
}

export async function baixarAssinado(session: SessionContext, packageId: string): Promise<ActionResult<{ url: string }>> {
  const pkg = await lerPacote(packageId);
  if (!pkg) return { ok: false, error: NAO_ENCONTRADO };
  if (!canDownloadSignatures(session, pkg.clinic_id)) return { ok: false, error: "Você não tem permissão para baixar documentos assinados." };
  if (pkg.status !== "signed") return { ok: false, error: "Este pacote ainda não está assinado por todos." };
  if (!pkg.signed_pdf_path) return { ok: false, error: "O PDF assinado ainda está sendo buscado na ZapSign. Tente de novo mais tarde." };
  const url = await urlAssinada(pkg.signed_pdf_path, nomeDoArquivo(pkg.number, "pacote", "assinado"));
  if (!url) return { ok: false, error: "Não foi possível preparar o download agora. Tente de novo em instantes." };
  await registrar(pkg, "download", { file: "signed" });
  return { ok: true, url };
}

/** A cópia de UM documento, das páginas dele no PDF original, com a faixa. */
export async function baixarCopia(session: SessionContext, packageId: string, itemId: string): Promise<ActionResult<{ url: string }>> {
  const pkg = await lerPacote(packageId);
  if (!pkg) return { ok: false, error: NAO_ENCONTRADO };
  if (!canDownloadSignatures(session, pkg.clinic_id)) return { ok: false, error: "Você não tem permissão para baixar documentos." };
  if (!pkg.merged_pdf_path || !pkg.sent_at) return { ok: false, error: "Este pacote não tem PDF enviado." };

  const supabase = await createClient();
  const { data: item } = await supabase
    .from("signature_package_items")
    .select("id, title, first_page, last_page")
    .eq("id", itemId)
    .eq("package_id", pkg.id)
    .maybeSingle();
  if (!item) return { ok: false, error: "Documento não encontrado neste pacote." };
  if (!item.first_page || !item.last_page) return { ok: false, error: "As páginas deste documento não foram registradas no envio." };

  const file = await supabase.storage.from(BUCKET).download(pkg.merged_pdf_path);
  if (file.error || !file.data) return { ok: false, error: "Não foi possível ler o PDF original do pacote." };
  let bytes: Uint8Array;
  try {
    const copia = await gerarCopia({
      merged: new Uint8Array(await file.data.arrayBuffer()),
      firstPage: item.first_page,
      lastPage: item.last_page,
      packageNumber: pkg.number,
      title: item.title,
    });
    bytes = copia.bytes;
  } catch (e) {
    console.error("signature copy failed:", e instanceof Error ? e.message : String(e));
    return { ok: false, error: "Não foi possível montar a cópia deste documento." };
  }

  // A cópia nasce no servidor (o bucket não aceita gravação de logado) e é
  // regravada a cada pedido — a faixa leva o número do pacote, nada mais.
  const dir = pkg.merged_pdf_path.replace(/merged\.pdf$/, "");
  const path = `${dir}copias/${item.id}.pdf`;
  const admin = createAdminClient();
  const up = await admin.storage
    .from(BUCKET)
    .upload(path, new Blob([Buffer.from(bytes)], { type: "application/pdf" }), { upsert: true, contentType: "application/pdf" });
  if (up.error) {
    console.error("signature copy upload failed:", up.error.message);
    return { ok: false, error: "Não foi possível preparar a cópia agora. Tente de novo em instantes." };
  }
  const url = await urlAssinada(path, nomeDoArquivo(pkg.number, item.title, "copia"));
  if (!url) return { ok: false, error: "Não foi possível preparar o download agora. Tente de novo em instantes." };
  await registrar(pkg, "download_copy", { item_id: item.id });
  return { ok: true, url };
}

export type ResendSigner = {
  id: string;
  name: string;
  qualification: string;
  orderGroup: number;
  isTurn: boolean;
  signUrl: string;
  phone: string | null;
  message: string;
  lastNotifiedAt: string | null;
};

const STAGE_GROUP: Record<PackageStage, number> = { client: 1, witnesses: 2, risarte: 3, done: 0 };

/** Quem ainda falta assinar, com o link e a mensagem padrão pronta. */
export async function carregarReenvio(
  session: SessionContext,
  packageId: string
): Promise<ActionResult<{ number: string; signers: ResendSigner[]; zapsignEmail: boolean }>> {
  const pkg = await lerPacote(packageId);
  if (!pkg) return { ok: false, error: NAO_ENCONTRADO };
  if (!canSendSignatures(session, pkg.clinic_id)) return { ok: false, error: "Você não tem permissão para reenviar documentos." };
  if (pkg.status !== "sent" && pkg.status !== "partially_signed") return { ok: false, error: "Este pacote não está aguardando assinatura." };

  const supabase = await createClient();
  const admin = createAdminClient();
  const [{ data: signers }, { data: settings }, { data: clinic }] = await Promise.all([
    supabase
      .from("signature_signers")
      .select("id, name, signer_type, order_group, sort_order, status, sign_url, phone, last_notified_at")
      .eq("package_id", pkg.id)
      .in("status", ["pending", "link_opened"])
      .order("order_group")
      .order("sort_order"),
    admin.from("signature_settings").select("default_message, zapsign_emails_enabled").eq("id", true).maybeSingle(),
    admin.from("clinics").select("name").eq("id", pkg.clinic_id).maybeSingle(),
  ]);
  const template = settings?.default_message ?? "{{link}}";
  const prazo = pkg.expires_at ? formatBrDate(pkg.expires_at) : "";
  const turn = STAGE_GROUP[pkg.current_stage];
  return {
    ok: true,
    number: pkg.number,
    zapsignEmail: !!settings?.zapsign_emails_enabled && !!pkg.zapsign_doc_token,
    signers: (signers ?? [])
      .filter((s) => !!s.sign_url)
      .map((s) => ({
        id: s.id,
        name: s.name,
        qualification: qualificacao(s.signer_type),
        orderGroup: s.order_group,
        isTurn: s.order_group === turn,
        signUrl: s.sign_url!,
        phone: s.phone,
        message: montarMensagem(template, { nome: primeiroNome(s.name), unidade: clinic?.name ?? "", link: s.sign_url!, prazo }),
        lastNotifiedAt: s.last_notified_at,
      })),
  };
}

export type ResendChannel = "whatsapp_link" | "copy_link" | "sign_now";

/** A pessoa abriu o WhatsApp / copiou o link / abriu para assinar: fica a data. */
export async function registrarReenvio(session: SessionContext, packageId: string, signerId: string, channel: ResendChannel): Promise<ActionResult> {
  const pkg = await lerPacote(packageId);
  if (!pkg) return { ok: false, error: NAO_ENCONTRADO };
  if (!canSendSignatures(session, pkg.clinic_id)) return { ok: false, error: "Você não tem permissão para reenviar documentos." };
  if (!["whatsapp_link", "copy_link", "sign_now"].includes(channel)) return { ok: false, error: "Canal inválido." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("signature_mark_notified", { p_package_id: pkg.id, p_signer_ids: [signerId], p_channel: channel });
  if (error) return { ok: false, error: mensagemDaPortaZs4(error.message) };
  await logAudit({ action: "update", entityType: "signature_package", entityId: pkg.id, clinicId: pkg.clinic_id, details: { what: "resend", channel } });
  return { ok: true };
}

/** "Reenviar pelo e-mail da ZapSign": todos os pendentes da vez, de uma vez. */
export async function reenviarPorEmailZapsign(session: SessionContext, packageId: string): Promise<ActionResult> {
  const pkg = await lerPacote(packageId);
  if (!pkg) return { ok: false, error: NAO_ENCONTRADO };
  if (!canSendSignatures(session, pkg.clinic_id)) return { ok: false, error: "Você não tem permissão para reenviar documentos." };
  if (!pkg.zapsign_doc_token) return { ok: false, error: "Este pacote não está na ZapSign." };
  const admin = createAdminClient();
  const { data: settings } = await admin.from("signature_settings").select("zapsign_emails_enabled").eq("id", true).maybeSingle();
  if (!settings?.zapsign_emails_enabled) return { ok: false, error: "O e-mail da ZapSign está desligado nas configurações." };
  try {
    if (!isZapsignFake()) await resendNotifications(pkg.zapsign_doc_token);
  } catch (e) {
    console.error("signature resend failed:", e instanceof ZapsignError ? e.logMessage : String(e));
    if (e instanceof ZapsignError && e.code === "rate_limited") {
      return { ok: false, error: "A ZapSign acabou de reenviar este pacote. Espere alguns minutos antes de reenviar de novo." };
    }
    return { ok: false, error: mensagemDaZapsign(e) };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("signature_mark_notified", { p_package_id: pkg.id, p_signer_ids: null, p_channel: "zapsign_email" });
  if (error) console.error("signature_mark_notified failed:", error.message);
  await logAudit({ action: "update", entityType: "signature_package", entityId: pkg.id, clinicId: pkg.clinic_id, details: { what: "resend", channel: "zapsign_email" } });
  return { ok: true };
}

/**
 * CANCELAR (ZS4): primeiro a ZapSign (`refuse`), depois a porta do banco.
 * Se a ZapSign falhar, NADA muda aqui — o pacote não pode ficar cancelado no
 * riSZon e assinável lá. Rascunho (nunca enviado) só cancela aqui.
 */
export async function cancelarPacote(session: SessionContext, packageId: string, reason: string): Promise<ActionResult<{ number: string }>> {
  const motivo = (reason ?? "").trim();
  if (!motivo) return { ok: false, error: "Escreva o motivo do cancelamento." };
  if (motivo.length > 500) return { ok: false, error: "O motivo pode ter até 500 caracteres." };
  const pkg = await lerPacote(packageId);
  if (!pkg) return { ok: false, error: NAO_ENCONTRADO };
  if (!canCancelSignatures(session, pkg.clinic_id)) return { ok: false, error: "Você não tem permissão para cancelar documentos." };
  if (pkg.status === "signed") return { ok: false, error: "Documento assinado não pode ser cancelado." };
  if (pkg.status === "cancelled") return { ok: false, error: "Este pacote já está cancelado." };
  if (!["draft", "sent", "partially_signed"].includes(pkg.status)) return { ok: false, error: "Só pacote aguardando assinatura pode ser cancelado." };

  if (pkg.zapsign_doc_token) {
    const admin = createAdminClient();
    const { data: settings } = await admin.from("signature_settings").select("zapsign_emails_enabled").eq("id", true).maybeSingle();
    try {
      if (isZapsignFake()) await refuseDocumentFake();
      else
        await refuseDocument({
          doc_token: pkg.zapsign_doc_token,
          rejected_reason: `Cancelado no riSZon: ${motivo}`.slice(0, 500),
          notify_signer: !!settings?.zapsign_emails_enabled,
        });
    } catch (e) {
      console.error("signature cancel (zapsign) failed:", e instanceof ZapsignError ? e.logMessage : String(e));
      if (e instanceof ZapsignError && e.code === "document_already_signed") {
        return { ok: false, error: "A ZapSign diz que este documento já foi assinado. Ele não pode ser cancelado; a situação será atualizada em instantes." };
      }
      return { ok: false, error: `Não foi possível cancelar na ZapSign, então nada foi cancelado. ${mensagemDaZapsign(e)}` };
    }
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("signature_cancel_package", { p_id: pkg.id, p_reason: motivo });
  if (error) {
    console.error("signature_cancel_package failed after zapsign refuse:", error.message);
    return { ok: false, error: mensagemDaPortaZs4(error.message) };
  }
  await logAudit({ action: "update", entityType: "signature_package", entityId: pkg.id, clinicId: pkg.clinic_id, details: { what: "cancel" } });
  return { ok: true, number: pkg.number };
}

export function mensagemDaPortaZs4(msg: string | undefined): string {
  const m = msg ?? "";
  if (m.includes("PACKAGE_SIGNED")) return "Documento assinado não pode ser cancelado.";
  if (m.includes("ALREADY_CANCELLED")) return "Este pacote já está cancelado.";
  if (m.includes("NOT_CANCELLABLE")) return "Só pacote aguardando assinatura pode ser cancelado.";
  if (m.includes("REASON_REQUIRED")) return "Escreva o motivo do cancelamento.";
  if (m.includes("NOT_WAITING")) return "Este pacote não está aguardando assinatura.";
  if (m.includes("NOT_ALLOWED")) return "Você não tem permissão para esta ação nesta unidade.";
  if (m.includes("PACKAGE_NOT_FOUND")) return NAO_ENCONTRADO;
  if (/does not exist|Could not find the function/i.test(m)) return "Falta a migração 0344 neste banco.";
  return "Não foi possível concluir. Tente de novo em instantes.";
}
