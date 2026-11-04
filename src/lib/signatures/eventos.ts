/**
 * O QUE CADA EVENTO DO PACOTE QUER DIZER, PARA A TELA (ZS4). O log
 * `signature_events` guarda tudo (webhook, ações, falhas técnicas); o detalhe
 * do pacote mostra só o que ajuda a entender a história. Evento sem rótulo
 * aqui não aparece. Regra pura.
 */

export const EVENT_LABEL: Record<string, string> = {
  package_created: "Pacote preparado",
  sent: "Enviado à ZapSign",
  send_failed: "Falha ao enviar à ZapSign",
  send_mark_skipped: "Enviado, mas a gravação do envio não pegou (falta quem enviou)",
  resent_from: "Criado como reenvio de outro pacote",
  new_send_reason: "Enviado de novo um documento já assinado",
  webhook_doc_signed: "Assinatura registrada pela ZapSign",
  webhook_doc_refused: "Recusado na ZapSign",
  webhook_doc_expired: "Prazo vencido na ZapSign",
  webhook_doc_deleted: "Excluído na ZapSign",
  webhook_doc_viewed: "Aberto pelo signatário",
  signed_file_saved: "PDF assinado guardado no riSZon",
  pending_download: "PDF assinado ainda não baixado da ZapSign",
  copy_sent: "Cópia assinada enviada ao cliente",
  copy_failed: "Falha ao enviar a cópia ao cliente",
  copy_skipped: "Cópia ao cliente não enviada (sem e-mail)",
  closing_failed: "Não foi possível marcar a venda como fechada",
  "action:view": "Visualizado",
  "action:download": "PDF assinado baixado",
  "action:download_copy": "Cópia de documento baixada",
  "action:resend": "Link reenviado",
  "action:cancel": "Cancelado",
};

/** Eventos que pedem atenção (o detalhe pinta de âmbar). */
export const EVENT_WARNING = new Set(["new_send_reason", "send_failed", "send_mark_skipped", "pending_download", "copy_failed", "closing_failed"]);

export const RESEND_CHANNEL_LABEL: Record<string, string> = {
  whatsapp_link: "WhatsApp",
  copy_link: "link copiado",
  sign_now: "assinar agora",
  zapsign_email: "e-mail da ZapSign",
};

export function rotuloDoEvento(eventType: string, payload: Record<string, unknown> | null): string | null {
  const base = EVENT_LABEL[eventType];
  if (!base) return null;
  if (eventType === "action:resend" && payload && typeof payload.channel === "string") {
    return `${base} (${RESEND_CHANNEL_LABEL[payload.channel] ?? payload.channel})`;
  }
  if (eventType === "action:view" && payload?.file === "signed") return "Visualizado (PDF assinado)";
  if (eventType === "new_send_reason" && payload) {
    const antes = typeof payload.previous_number === "string" ? ` (já assinado no ${payload.previous_number})` : "";
    const motivo = typeof payload.reason === "string" && payload.reason ? ` — motivo: ${payload.reason}` : "";
    return `${base}${antes}${motivo}`;
  }
  return base;
}
