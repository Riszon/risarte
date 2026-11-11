import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isEmailConfigured } from "@/lib/notify/email";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ZapsignWebhookEvent } from "@/lib/zapsign/webhook";
import { BUCKET } from "./send";
import { enfileirarCopias, mandarCopiasDoPacote } from "./fila-de-email";
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
    // AP153: a cópia vai para a fila de cada pessoa do lado do cliente; com o
    // e-mail ligado e o PDF guardado, sai na hora (senão a rotina manda).
    const fila = await enfileirarCopias(admin, r.package_id, { registrarSemEmail: true });
    out.copy = fila === "queued" && isEmailConfigured() && out.signedFile === "saved" ? await mandarCopiasDoPacote(admin, r.package_id) : fila;
  }
  return out;
}

/** Também usada pela rotina de hora em hora (ZS6) para o PDF que faltou. */
export async function guardarAssinado(
  admin: SupabaseClient,
  fetchImpl: typeof fetch,
  r: PortaResult,
  event: Pick<ZapsignWebhookEvent, "signedFileUrl">
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
    // A pasta segue o público do pacote (plano §6): paciente ou empresa (ZS5).
    const { data: dono } = await admin.from("signature_packages").select("audience").eq("id", packageId).maybeSingle();
    const publico = dono?.audience === "company" ? "company" : "patient";
    const path = `${r.clinic_id}/${publico}/${packageId}/signed.pdf`;
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
