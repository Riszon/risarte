import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { formatBrDate } from "@/lib/dates";
import { sendEmail } from "@/lib/notify/email";
import { BUCKET } from "./send";

/**
 * A FILA DE E-MAIL DA ASSINATURA (`signature_outbox`) — pôr e mandar, num
 * lugar só (AP153, revisão de 11/11/2026).
 *
 * O defeito: a cópia assinada entrava na fila com o anexo de NAQUELE momento.
 * Se o PDF assinado ainda não tinha baixado, o anexo ficava vazio para sempre
 * e o e-mail saía SEM o PDF dizendo "a cópia vai anexa". Agora:
 *   - o anexo da cópia é resolvido NA HORA DE MANDAR, pelo pacote;
 *   - sem o PDF guardado, a cópia ESPERA (não gasta tentativa);
 *   - a cópia vai a cada pessoa do lado do cliente com e-mail (paciente,
 *     responsável, representante da empresa), uma vez por e-mail;
 *   - a rotina de hora em hora cria a cópia que faltou (o aviso pode ter caído
 *     entre gravar no banco e pôr na fila);
 *   - alerta de consumo com mais de 7 dias não sai mais (seria notícia velha
 *     quando o e-mail for ligado).
 */

export const MAX_TENTATIVAS = 3;
export const ALERTA_VALE_DIAS = 7;

type LinhaDaFila = {
  id: number;
  kind: string;
  package_id: string | null;
  to_email: string;
  to_name: string | null;
  subject: string;
  body_text: string;
  attachment_path: string | null;
  attempts: number;
  created_at: string;
};

export type ResultadoDaLinha = "sent" | "failed" | "waiting" | "discarded";

/** Regra pura: o que fazer com a linha antes de tentar mandar. */
export function decidirLinha(
  linha: Pick<LinhaDaFila, "kind" | "attachment_path" | "created_at">,
  pdfDoPacote: string | null,
  agora: Date = new Date()
): { acao: "mandar"; anexo: string | null } | { acao: "esperar" } | { acao: "descartar"; motivo: string } {
  if (linha.kind === "plan_alert" && agora.getTime() - Date.parse(linha.created_at) > ALERTA_VALE_DIAS * 86_400_000) {
    return { acao: "descartar", motivo: `alerta com mais de ${ALERTA_VALE_DIAS} dias — não enviado` };
  }
  if (linha.kind === "signed_copy") {
    const anexo = linha.attachment_path ?? pdfDoPacote;
    if (!anexo) return { acao: "esperar" };
    return { acao: "mandar", anexo };
  }
  return { acao: "mandar", anexo: linha.attachment_path };
}

/** Quem recebe a cópia: o lado do cliente com e-mail, sem repetir e-mail. */
export function destinatariosDaCopia(signers: { name: string; email: string | null; order_group: number }[]): { name: string; email: string }[] {
  const vistos = new Set<string>();
  const out: { name: string; email: string }[] = [];
  for (const s of signers) {
    if (s.order_group !== 1 || !s.email) continue;
    const chave = s.email.trim().toLowerCase();
    if (!chave || vistos.has(chave)) continue;
    vistos.add(chave);
    out.push({ name: s.name, email: s.email.trim() });
  }
  return out;
}

/**
 * Põe na fila a cópia assinada de um pacote para cada destinatário que ainda
 * não tem a sua. `registrarSemEmail`: só o aviso da ZapSign registra o
 * "cliente sem e-mail" (a rotina não repete o registro a cada hora).
 */
export async function enfileirarCopias(
  admin: SupabaseClient,
  packageId: string,
  opcoes: { registrarSemEmail?: boolean } = {}
): Promise<"queued" | "not_needed"> {
  const [{ data: signers }, { data: pkg }, { data: jaNaFila }] = await Promise.all([
    admin.from("signature_signers").select("name, email, order_group, sort_order").eq("package_id", packageId).order("sort_order"),
    admin.from("signature_packages").select("number, status, completed_at, cover_data").eq("id", packageId).maybeSingle(),
    admin.from("signature_outbox").select("to_email").eq("package_id", packageId).eq("kind", "signed_copy"),
  ]);
  if (!pkg || pkg.status !== "signed") return "not_needed";
  const destinos = destinatariosDaCopia(signers ?? []);
  if (destinos.length === 0) {
    if (opcoes.registrarSemEmail) {
      await admin.from("signature_events").insert({ package_id: packageId, event_type: "copy_skipped", error: "cliente sem e-mail" });
    }
    return "not_needed";
  }
  const existentes = new Set((jaNaFila ?? []).map((x) => String(x.to_email).trim().toLowerCase()));
  const clinicName = (pkg.cover_data as { clinic_name?: string } | null)?.clinic_name ?? "Risarte Odontologia";
  const subject = `Seus documentos assinados — ${pkg.number}`;
  const novos = destinos
    .filter((d) => !existentes.has(d.email.toLowerCase()))
    .map((d) => ({
      kind: "signed_copy",
      package_id: packageId,
      to_email: d.email,
      to_name: d.name,
      subject,
      body_text:
        `Olá, ${d.name.split(/\s+/)[0]}!\n\n` +
        `Todos assinaram os documentos do pacote ${pkg.number} da ${clinicName}` +
        (pkg.completed_at ? ` em ${formatBrDate(pkg.completed_at)}` : "") +
        `. A cópia assinada vai anexa a este e-mail.\n\nQualquer dúvida, fale com a unidade.\n\nRisarte Odontologia`,
      // O anexo é resolvido na hora de mandar (AP153): nunca congelar aqui.
      attachment_path: null,
    }));
  if (novos.length > 0) {
    const { error } = await admin.from("signature_outbox").insert(novos);
    if (error) console.error("signature_outbox:", error.message);
  }
  return "queued";
}

/** Manda UMA linha da fila. Quem chama já sabe que o e-mail está configurado. */
export async function mandarLinha(admin: SupabaseClient, m: LinhaDaFila): Promise<ResultadoDaLinha> {
  let pdfDoPacote: string | null = null;
  if (m.kind === "signed_copy" && !m.attachment_path && m.package_id) {
    const { data } = await admin.from("signature_packages").select("signed_pdf_path").eq("id", m.package_id).maybeSingle();
    pdfDoPacote = data?.signed_pdf_path ?? null;
  }
  const decisao = decidirLinha(m, pdfDoPacote);
  if (decisao.acao === "esperar") return "waiting";
  if (decisao.acao === "descartar") {
    await admin.from("signature_outbox").update({ status: "failed", last_error: decisao.motivo }).eq("id", m.id);
    return "discarded";
  }
  let anexos: { filename: string; bytes: Uint8Array }[] = [];
  if (decisao.anexo) {
    const baixado = await admin.storage.from(BUCKET).download(decisao.anexo);
    if (baixado.error || !baixado.data) {
      // Sem o anexo o e-mail não sai (a cópia assinada é o motivo dele).
      await marcarFalha(admin, m.id, m.attempts, "anexo não encontrado no bucket");
      return "failed";
    }
    anexos = [{ filename: decisao.anexo.split("/").pop() ?? "documento.pdf", bytes: new Uint8Array(await baixado.data.arrayBuffer()) }];
  }
  const r = await sendEmail({ to: m.to_email, toName: m.to_name ?? undefined, subject: m.subject, text: m.body_text, attachments: anexos });
  if (r.ok) {
    await admin
      .from("signature_outbox")
      .update({ status: "sent", sent_at: new Date().toISOString(), attempts: m.attempts + 1, last_error: null, attachment_path: decisao.anexo })
      .eq("id", m.id);
    if (m.kind === "signed_copy" && m.package_id) {
      await admin.from("signature_events").insert({ package_id: m.package_id, event_type: "copy_sent" });
    }
    return "sent";
  }
  await marcarFalha(admin, m.id, m.attempts, r.error);
  if (m.kind === "signed_copy" && m.package_id) {
    await admin.from("signature_events").insert({ package_id: m.package_id, event_type: "copy_failed", error: r.error.slice(0, 300) });
  }
  return "failed";
}

export const COLUNAS_DA_FILA = "id, kind, package_id, to_email, to_name, subject, body_text, attachment_path, attempts, created_at";

/** As linhas pendentes de um pacote (o aviso da ZapSign tenta mandar na hora). */
export async function mandarCopiasDoPacote(admin: SupabaseClient, packageId: string): Promise<"sent" | "queued"> {
  const { data } = await admin
    .from("signature_outbox")
    .select(COLUNAS_DA_FILA)
    .eq("package_id", packageId)
    .eq("kind", "signed_copy")
    .eq("status", "pending");
  let algumaSaiu = false;
  for (const m of (data ?? []) as LinhaDaFila[]) {
    if ((await mandarLinha(admin, m)) === "sent") algumaSaiu = true;
  }
  return algumaSaiu ? "sent" : "queued";
}

async function marcarFalha(admin: SupabaseClient, id: number, tentativas: number, erro: string) {
  const agora = tentativas + 1;
  await admin
    .from("signature_outbox")
    .update({ attempts: agora, last_error: erro.slice(0, 300), status: agora >= MAX_TENTATIVAS ? "failed" : "pending" })
    .eq("id", id);
}

export type { LinhaDaFila };
