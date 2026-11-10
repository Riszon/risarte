import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isEmailConfigured, sendEmail } from "@/lib/notify/email";
import { createAdminClient } from "@/lib/supabase/admin";
import { getDocument, isZapsignConfigured, isZapsignFake, zapsignEnv } from "@/lib/zapsign";
import { eventosDaConferencia } from "./conferencia";
import { contagemConfirmada } from "@/lib/contagem";
import { BUCKET } from "./send";
import { aplicarWebhook, guardarAssinado } from "./webhook-apply";

/**
 * A ROTINA DE HORA EM HORA (ZS6, plano ZS0 §5.7) — `/api/cron/signatures-hourly`,
 * no minuto 15 de cada hora (`vercel.json`). Três trabalhos, nesta ordem:
 *
 *   1. CONFERIR na ZapSign o pacote aguardando assinatura e sem notícia há
 *      mais de `reconcile_after_hours` (padrão 6 h): a diferença vira eventos
 *      no formato do webhook (`eventosDaConferencia`) e passa pela MESMA porta,
 *      idempotente — o webhook que chegar depois é reconhecido como repetido.
 *   2. BUSCAR DE NOVO o PDF assinado que não veio na hora da última assinatura.
 *   3. MANDAR a fila de e-mail (`signature_outbox`): cópia assinada ao cliente
 *      e alertas de consumo. Sem o Resend, a fila espera (e a tela diz quantos).
 *      Até 3 tentativas por e-mail.
 *
 * Cada trabalho tem limite por rodada (a função da Vercel tem tempo contado) e
 * nunca derruba os outros: o erro de um pacote fica no rastro e a rodada segue.
 * O que fez vai para `signature_job_runs` (a tela de Configurações mostra).
 */

const LIMITE_CONFERENCIA = 40;
const LIMITE_DOWNLOADS = 20;
const LIMITE_EMAILS = 50;
const MAX_TENTATIVAS = 3;

export type RotinaHorariaStats = {
  conferidos: number;
  atualizados: number;
  pdfsBuscados: number;
  emailsEnviados: number;
  emailsComErro: number;
  /** `null` = a fila não pôde ser contada (AP136); o motivo vai em `erros`. */
  emailsNaFila: number | null;
  zapsign: "ligada" | "falsa" | "sem token";
  email: "ligado" | "sem configuração";
  erros: string[];
};

export async function rodarRotinaHoraria(deps: { admin?: SupabaseClient; fetchImpl?: typeof fetch } = {}): Promise<RotinaHorariaStats> {
  const admin = deps.admin ?? createAdminClient();
  const fetchImpl = deps.fetchImpl ?? fetch;
  const stats: RotinaHorariaStats = {
    conferidos: 0,
    atualizados: 0,
    pdfsBuscados: 0,
    emailsEnviados: 0,
    emailsComErro: 0,
    emailsNaFila: 0,
    zapsign: isZapsignFake() ? "falsa" : isZapsignConfigured() ? "ligada" : "sem token",
    email: isEmailConfigured() ? "ligado" : "sem configuração",
    erros: [],
  };

  // A ZapSign de mentira (treino/dev) não tem documento para consultar.
  if (stats.zapsign === "ligada") {
    await conferir(admin, fetchImpl, stats);
    await buscarPdfsPendentes(admin, fetchImpl, stats);
  }
  await mandarFila(admin, stats);

  const { error } = await admin.rpc("signature_log_job_run", {
    p_job: "hourly",
    p_stats: stats,
    p_error: stats.erros.length ? stats.erros.slice(0, 5).join(" | ") : null,
  });
  if (error) console.error("signature hourly log:", error.message);
  return stats;
}

async function conferir(admin: SupabaseClient, fetchImpl: typeof fetch, stats: RotinaHorariaStats) {
  const { data: settings } = await admin.from("signature_settings").select("reconcile_after_hours").eq("id", true).maybeSingle();
  const horas = Math.max(1, Number(settings?.reconcile_after_hours ?? 6));
  const corte = new Date(Date.now() - horas * 3_600_000).toISOString();
  const { data: pacotes, error } = await admin
    .from("signature_packages")
    .select("id, zapsign_doc_token")
    .in("status", ["sent", "partially_signed"])
    .not("zapsign_doc_token", "is", null)
    .lt("sent_at", corte)
    .order("sent_at")
    .limit(LIMITE_CONFERENCIA * 3);
  if (error) {
    stats.erros.push(`conferência: ${error.message}`);
    return;
  }
  for (const p of pacotes ?? []) {
    if (stats.conferidos >= LIMITE_CONFERENCIA) break;
    // Teve notícia (webhook, ação ou conferência) nas últimas horas? Pula.
    const { data: ultimo } = await admin
      .from("signature_events")
      .select("created_at")
      .eq("package_id", p.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (ultimo?.created_at && ultimo.created_at > corte) continue;
    stats.conferidos++;
    try {
      const doc = await getDocument(p.zapsign_doc_token as string);
      const { data: locais } = await admin.from("signature_signers").select("zapsign_signer_token, status").eq("package_id", p.id);
      const eventos = eventosDaConferencia({
        doc,
        locais: (locais ?? []).map((l) => ({ token: l.zapsign_signer_token, status: l.status })),
        packageId: p.id,
        sandbox: zapsignEnv() === "sandbox",
      });
      for (const ev of eventos) {
        const r = await aplicarWebhook(ev, { admin, fetchImpl });
        if (!r.duplicate && r.matched) stats.atualizados++;
      }
      await admin.from("signature_events").insert({
        package_id: p.id,
        event_type: "reconcile_checked",
        payload: { zapsign_status: doc.status ?? null, applied: eventos.length },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      stats.erros.push(`conferência ${p.id}: ${msg.slice(0, 120)}`);
      await admin.from("signature_events").insert({ package_id: p.id, event_type: "reconcile_failed", error: msg.slice(0, 300) });
    }
  }
}

async function buscarPdfsPendentes(admin: SupabaseClient, fetchImpl: typeof fetch, stats: RotinaHorariaStats) {
  const { data: pacotes, error } = await admin
    .from("signature_packages")
    .select("id, clinic_id, number, zapsign_doc_token")
    .eq("status", "signed")
    .is("signed_pdf_path", null)
    .not("zapsign_doc_token", "is", null)
    .order("completed_at")
    .limit(LIMITE_DOWNLOADS);
  if (error) {
    stats.erros.push(`PDF assinado: ${error.message}`);
    return;
  }
  for (const p of pacotes ?? []) {
    try {
      const doc = await getDocument(p.zapsign_doc_token as string);
      if (!doc.signed_file) continue;
      const r = await guardarAssinado(
        admin,
        fetchImpl,
        { duplicate: false, matched: true, package_id: p.id, clinic_id: p.clinic_id, number: p.number },
        { signedFileUrl: doc.signed_file }
      );
      if (r === "saved") stats.pdfsBuscados++;
    } catch (e) {
      stats.erros.push(`PDF ${p.id}: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`);
    }
  }
}

async function mandarFila(admin: SupabaseClient, stats: RotinaHorariaStats) {
  // AP136: fila que não deu para contar NÃO é fila vazia. Antes virava zero e
  // a rotina saía sem mandar nada e sem dizer por quê. Agora registra o erro e
  // segue: a leitura da fila, logo abaixo, é quem decide se há o que mandar.
  stats.emailsNaFila = contagemConfirmada(
    await admin.from("signature_outbox").select("id", { count: "exact", head: true }).eq("status", "pending")
  );
  if (stats.emailsNaFila === null) stats.erros.push("fila: não foi possível contar os e-mails pendentes");
  if (stats.email !== "ligado" || stats.emailsNaFila === 0) return;

  const { data: fila, error } = await admin
    .from("signature_outbox")
    .select("id, to_email, to_name, subject, body_text, attachment_path, attempts")
    .eq("status", "pending")
    .order("created_at")
    .limit(LIMITE_EMAILS);
  if (error) {
    stats.erros.push(`fila: ${error.message}`);
    return;
  }
  for (const m of fila ?? []) {
    let anexos: { filename: string; bytes: Uint8Array }[] = [];
    if (m.attachment_path) {
      const baixado = await admin.storage.from(BUCKET).download(m.attachment_path);
      if (baixado.error || !baixado.data) {
        // Sem o anexo o e-mail não sai (a cópia assinada é o motivo dele).
        await marcarFalha(admin, m.id, m.attempts, "anexo não encontrado no bucket");
        stats.emailsComErro++;
        continue;
      }
      anexos = [{ filename: m.attachment_path.split("/").pop() ?? "documento.pdf", bytes: new Uint8Array(await baixado.data.arrayBuffer()) }];
    }
    const r = await sendEmail({ to: m.to_email, toName: m.to_name, subject: m.subject, text: m.body_text, attachments: anexos });
    if (r.ok) {
      await admin.from("signature_outbox").update({ status: "sent", sent_at: new Date().toISOString(), attempts: m.attempts + 1, last_error: null }).eq("id", m.id);
      stats.emailsEnviados++;
    } else {
      await marcarFalha(admin, m.id, m.attempts, r.error);
      stats.emailsComErro++;
    }
  }
  stats.emailsNaFila = contagemConfirmada(
    await admin.from("signature_outbox").select("id", { count: "exact", head: true }).eq("status", "pending")
  );
  if (stats.emailsNaFila === null) stats.erros.push("fila: não foi possível contar o que restou");
}

async function marcarFalha(admin: SupabaseClient, id: number, tentativas: number, erro: string) {
  const agora = tentativas + 1;
  await admin
    .from("signature_outbox")
    .update({ attempts: agora, last_error: erro.slice(0, 300), status: agora >= MAX_TENTATIVAS ? "failed" : "pending" })
    .eq("id", id);
}
