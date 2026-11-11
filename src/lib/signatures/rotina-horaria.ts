import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isEmailConfigured } from "@/lib/notify/email";
import { createAdminClient } from "@/lib/supabase/admin";
import { getDocument, isZapsignConfigured, isZapsignFake, zapsignEnv } from "@/lib/zapsign";
import { eventosDaConferencia } from "./conferencia";
import { contagemConfirmada } from "@/lib/contagem";
import { lerPorLotes } from "@/lib/paginar";
import { aplicarWebhook, guardarAssinado } from "./webhook-apply";
import { avisarFalhas } from "./avisos-de-falha";
import { COLUNAS_DA_FILA, enfileirarCopias, mandarLinha, type LinhaDaFila } from "./fila-de-email";

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
const MAX_TENTATIVAS_PDF = 12;

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
  await copiasQueFaltam(admin, stats);
  await mandarFila(admin, stats);
  // AP155: falha do pós-assinatura e rotina parada viram aviso ao Admin.
  await avisarFalhas(admin, stats);

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
  // AP155: antes só os 120 mais antigos entravam na conta e o resto nunca era
  // conferido. Agora a lista inteira (até 1.000) é filtrada de uma vez pelo
  // que teve notícia nas últimas horas — quem foi conferido agora espera a
  // vez, e os de trás chegam a ela.
  // AP154: entram também os vencidos nos últimos 7 dias — a ZapSign pode ter
  // assinatura feita no limite (a porta, 0396, só aplica ao vencido pela rotina).
  const seteDias = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [abertos, vencidos] = await Promise.all([
    admin
      .from("signature_packages")
      .select("id, zapsign_doc_token")
      .in("status", ["sent", "partially_signed"])
      .not("zapsign_doc_token", "is", null)
      .lt("sent_at", corte)
      .order("sent_at")
      .limit(1000),
    admin
      .from("signature_packages")
      .select("id, zapsign_doc_token")
      .eq("status", "expired")
      .not("zapsign_doc_token", "is", null)
      .gte("expires_at", seteDias)
      .order("expires_at")
      .limit(200),
  ]);
  const erro = abertos.error ?? vencidos.error;
  if (erro) {
    stats.erros.push(`conferência: ${erro.message}`);
    return;
  }
  const candidatos = [...(abertos.data ?? []), ...(vencidos.data ?? [])];
  // Quem teve notícia nas últimas horas — lido em lotes (a API corta em 1.000).
  const recentes = await lerPorLotes<{ package_id: string }>(
    candidatos.map((p) => p.id),
    (lote, de, ate) => admin.from("signature_events").select("package_id").in("package_id", lote).gt("created_at", corte).range(de, ate)
  );
  if (!recentes.ok) {
    stats.erros.push("conferência: não foi possível ler as notícias recentes");
    return;
  }
  const comNoticia = new Set(recentes.linhas.map((e) => e.package_id));
  const pacotes = candidatos.filter((p) => !comNoticia.has(p.id));
  for (const p of pacotes) {
    if (stats.conferidos >= LIMITE_CONFERENCIA) break;
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
  // AP155: o PDF que nunca baixa (documento de teste, apagado na ZapSign) não
  // ocupa mais a vaga para sempre: depois de MAX_TENTATIVAS_PDF falhas o
  // pacote sai da busca e o Admin é avisado (`pdf_fetch_gave_up`).
  const { data: candidatos, error } = await admin
    .from("signature_packages")
    .select("id, clinic_id, number, zapsign_doc_token")
    .eq("status", "signed")
    .is("signed_pdf_path", null)
    .not("zapsign_doc_token", "is", null)
    .order("completed_at")
    .limit(200);
  if (error) {
    stats.erros.push(`PDF assinado: ${error.message}`);
    return;
  }
  const ids = (candidatos ?? []).map((p) => p.id);
  const { data: tentativas } = ids.length
    ? await admin.from("signature_events").select("package_id, event_type").in("package_id", ids).in("event_type", ["pdf_fetch_failed", "pdf_fetch_gave_up"])
    : { data: [] as { package_id: string; event_type: string }[] };
  const falhas = new Map<string, number>();
  const desistidos = new Set<string>();
  for (const t of tentativas ?? []) {
    if (t.event_type === "pdf_fetch_gave_up") desistidos.add(t.package_id);
    else falhas.set(t.package_id, (falhas.get(t.package_id) ?? 0) + 1);
  }
  const pacotes = (candidatos ?? []).filter((p) => !desistidos.has(p.id)).slice(0, LIMITE_DOWNLOADS);
  for (const p of pacotes) {
    const falhou = async (motivo: string) => {
      stats.erros.push(`PDF ${p.id}: ${motivo.slice(0, 120)}`);
      await admin.from("signature_events").insert({ package_id: p.id, event_type: "pdf_fetch_failed", error: motivo.slice(0, 300) });
      if (desistirDoPdf((falhas.get(p.id) ?? 0) + 1)) {
        await admin.from("signature_events").insert({
          package_id: p.id,
          event_type: "pdf_fetch_gave_up",
          error: `O PDF assinado não veio da ZapSign em ${MAX_TENTATIVAS_PDF} tentativas: ${motivo.slice(0, 200)}`,
        });
      }
    };
    try {
      const doc = await getDocument(p.zapsign_doc_token as string);
      if (!doc.signed_file) {
        await falhou("a ZapSign ainda não tem o PDF assinado");
        continue;
      }
      const r = await guardarAssinado(
        admin,
        fetchImpl,
        { duplicate: false, matched: true, package_id: p.id, clinic_id: p.clinic_id, number: p.number },
        { signedFileUrl: doc.signed_file }
      );
      if (r === "saved") {
        stats.pdfsBuscados++;
        // AP153: a cópia ao cliente entra agora (se ainda não estava na fila).
        await enfileirarCopias(admin, p.id);
      } else await falhou("o download do PDF assinado falhou");
    } catch (e) {
      await falhou(e instanceof Error ? e.message : String(e));
    }
  }
}

/** Regra pura (AP155): a partir de quantas falhas a rotina desiste do PDF. */
export function desistirDoPdf(falhas: number): boolean {
  return falhas >= MAX_TENTATIVAS_PDF;
}

/**
 * AP153: a cópia que faltou. Se a função caiu entre gravar a assinatura no
 * banco e pôr a cópia na fila, a repetição da ZapSign é reconhecida como
 * repetida e a cópia nunca entraria. Pacote assinado nos últimos 7 dias, sem
 * cópia na fila, ganha a sua aqui.
 */
async function copiasQueFaltam(admin: SupabaseClient, stats: RotinaHorariaStats) {
  const seteDias = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data: assinados, error } = await admin
    .from("signature_packages")
    .select("id")
    .eq("status", "signed")
    .gte("completed_at", seteDias)
    .limit(200);
  if (error) {
    stats.erros.push(`cópias: ${error.message}`);
    return;
  }
  const ids = (assinados ?? []).map((p) => p.id);
  if (ids.length === 0) return;
  const { data: naFila } = await admin.from("signature_outbox").select("package_id").eq("kind", "signed_copy").in("package_id", ids);
  const comCopia = new Set((naFila ?? []).map((x) => x.package_id as string));
  for (const id of ids) if (!comCopia.has(id)) await enfileirarCopias(admin, id);
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
    .select(COLUNAS_DA_FILA)
    .eq("status", "pending")
    .order("created_at")
    .limit(LIMITE_EMAILS);
  if (error) {
    stats.erros.push(`fila: ${error.message}`);
    return;
  }
  for (const m of (fila ?? []) as LinhaDaFila[]) {
    const r = await mandarLinha(admin, m);
    if (r === "sent") stats.emailsEnviados++;
    else if (r === "failed") stats.emailsComErro++;
  }
  stats.emailsNaFila = contagemConfirmada(
    await admin.from("signature_outbox").select("id", { count: "exact", head: true }).eq("status", "pending")
  );
  if (stats.emailsNaFila === null) stats.erros.push("fila: não foi possível contar o que restou");
}

