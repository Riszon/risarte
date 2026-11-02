import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { formatBrDate } from "@/lib/dates";
import { isEmailConfigured, sendEmail } from "@/lib/notify/email";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ZapsignWebhookEvent } from "@/lib/zapsign/webhook";
import { BUCKET } from "./send";
import { eventoParaPorta, type PortaResult } from "./webhook-event";

/**
 * O WEBHOOK APLICADO (plano ZS0 §5.5), em três passos:
 *   1. a porta `signature_apply_webhook` (idempotente) atualiza o banco e
 *      avisa quem é o próximo e quem enviou;
 *   2. pacote recém-assinado: baixa o `signed_file` NA HORA (a URL expira em
 *      60 min) e guarda `signed.pdf` no bucket; se falhar, fica um evento
 *      `pending_download` para o cron horário (ZS6) tentar com `getDocument`;
 *   3. a cópia ao cliente entra na `signature_outbox`; se o e-mail estiver
 *      configurado, tenta mandar já — senão fica pendente e a tela diz
 *      "cópia não enviada".
 * Nada aqui derruba a resposta 200 à ZapSign: cada passo registra a própria
 * falha em `signature_events`.
 */

export type ApplyOutcome = {
  duplicate: boolean;
  matched: boolean;
  packageId: string | null;
  status: string | null;
  signedFile: "saved" | "pending" | "not_needed";
  copy: "sent" | "queued" | "not_needed";
};

export async function aplicarWebhook(
  event: ZapsignWebhookEvent,
  deps: { admin?: SupabaseClient; fetchImpl?: typeof fetch } = {}
): Promise<ApplyOutcome> {
  const admin = deps.admin ?? createAdminClient();
  const fetchImpl = deps.fetchImpl ?? fetch;
  const porta = eventoParaPorta(event);

  const { data, error } = await admin.rpc("signature_apply_webhook", { p_event: porta });
  if (error) {
    console.error("signature_apply_webhook:", error.message);
    throw new Error(`APPLY_FAILED: ${error.message}`);
  }
  const r = (data ?? {}) as PortaResult;
  const out: ApplyOutcome = {
    duplicate: !!r.duplicate,
    matched: !!r.matched,
    packageId: r.package_id ?? null,
    status: r.status ?? null,
    signedFile: "not_needed",
    copy: "not_needed",
  };
  if (r.duplicate || !r.matched || !r.package_id) return out;

  if (r.signed_file_needed) {
    out.signedFile = await guardarAssinado(admin, fetchImpl, r, event);
  }
  if (r.newly_signed) {
    out.copy = await enfileirarCopia(admin, r, out.signedFile === "saved");
  }
  return out;
}

async function guardarAssinado(
  admin: SupabaseClient,
  fetchImpl: typeof fetch,
  r: PortaResult,
  event: ZapsignWebhookEvent
): Promise<"saved" | "pending"> {
  const packageId = r.package_id!;
  const pendente = async (motivo: string) => {
    await admin.from("signature_events").insert({ package_id: packageId, event_type: "pending_download", error: motivo.slice(0, 300) });
    return "pending" as const;
  };
  if (!event.signedFileUrl) return pendente("webhook sem signed_file");
  try {
    const res = await fetchImpl(event.signedFileUrl, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return pendente(`download HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength < 100 || String.fromCharCode(...bytes.slice(0, 4)) !== "%PDF") return pendente("download não é um PDF");
    const path = `${r.clinic_id}/patient/${packageId}/signed.pdf`;
    const up = await admin.storage.from(BUCKET).upload(path, new Blob([Buffer.from(bytes)], { type: "application/pdf" }), { upsert: true, contentType: "application/pdf" });
    if (up.error) return pendente(`storage: ${up.error.message}`);
    const u = await admin.from("signature_packages").update({ signed_pdf_path: path }).eq("id", packageId);
    if (u.error) return pendente(`db: ${u.error.message}`);
    await admin.from("signature_events").insert({ package_id: packageId, event_type: "signed_file_saved", payload: { bytes: bytes.byteLength } });
    return "saved";
  } catch (e) {
    return pendente(e instanceof Error ? e.message : String(e));
  }
}

/**
 * A cópia assinada ao cliente: uma linha na fila (`signature_outbox`); com o
 * e-mail configurado e o PDF já guardado, tenta na hora.
 */
async function enfileirarCopia(admin: SupabaseClient, r: PortaResult, pdfSaved: boolean): Promise<"sent" | "queued" | "not_needed"> {
  const packageId = r.package_id!;
  const { data: signer } = await admin
    .from("signature_signers")
    .select("name, email")
    .eq("package_id", packageId)
    .eq("order_group", 1)
    .order("sort_order")
    .limit(1)
    .maybeSingle();
  if (!signer?.email) {
    await admin.from("signature_events").insert({ package_id: packageId, event_type: "copy_skipped", error: "cliente sem e-mail" });
    return "not_needed";
  }
  const { data: pkg } = await admin.from("signature_packages").select("number, clinic_id, expires_at, signed_pdf_path, completed_at, cover_data").eq("id", packageId).maybeSingle();
  const clinicName = (pkg?.cover_data as { clinic_name?: string } | null)?.clinic_name ?? "Risarte Odontologia";
  const subject = `Seus documentos assinados — ${pkg?.number ?? ""}`.trim();
  const text =
    `Olá, ${signer.name.split(/\s+/)[0]}!\n\n` +
    `Todos assinaram os documentos do pacote ${pkg?.number ?? ""} da ${clinicName}` +
    (pkg?.completed_at ? ` em ${formatBrDate(pkg.completed_at)}` : "") +
    `. A cópia assinada vai anexa a este e-mail.\n\nQualquer dúvida, fale com a unidade.\n\nRisarte Odontologia`;

  const { data: row, error } = await admin
    .from("signature_outbox")
    .insert({ kind: "signed_copy", package_id: packageId, to_email: signer.email, to_name: signer.name, subject, body_text: text, attachment_path: pkg?.signed_pdf_path ?? null })
    .select("id")
    .single();
  if (error || !row) {
    console.error("signature_outbox:", error?.message);
    return "queued";
  }
  if (!isEmailConfigured() || !pdfSaved || !pkg?.signed_pdf_path) return "queued";

  const file = await admin.storage.from(BUCKET).download(pkg.signed_pdf_path);
  if (file.error || !file.data) return "queued";
  const bytes = new Uint8Array(await file.data.arrayBuffer());
  const sent = await sendEmail({ to: signer.email, toName: signer.name, subject, text, attachments: [{ filename: `${pkg.number}-assinado.pdf`, bytes }] });
  await admin
    .from("signature_outbox")
    .update(sent.ok ? { status: "sent", sent_at: new Date().toISOString(), attempts: 1 } : { status: "pending", attempts: 1, last_error: sent.error })
    .eq("id", row.id);
  await admin.from("signature_events").insert({ package_id: packageId, event_type: sent.ok ? "copy_sent" : "copy_failed", error: sent.ok ? null : sent.error });
  return sent.ok ? "sent" : "queued";
}
