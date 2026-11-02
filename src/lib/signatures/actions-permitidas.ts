import type { PackageStatus } from "./types";

/**
 * QUAIS AÇÕES APARECEM NUM PACOTE (ZS4) — situação × permissão. Regra pura,
 * uma só para o detalhe do pacote e para a aba Documentos da ficha, testada
 * em `assinaturas-acoes.test.ts`. O banco confere de novo em cada porta
 * (`signature_cancel_package`, `signature_mark_notified`, a leitura do bucket):
 * esconder o botão é conforto, não a barreira.
 *
 *   * Visualizar — quem vê pacotes. Pendente mostra o PDF enviado
 *     (`merged.pdf`); assinado mostra o assinado quando ele já chegou.
 *   * Baixar assinado — quem baixa, só com o PDF assinado guardado.
 *   * Baixar cópia — quem baixa; sai do PDF ORIGINAL com a faixa "cópia".
 *   * Reenviar — quem envia, enquanto o pacote espera alguém.
 *   * Reenviar por e-mail da ZapSign — o mesmo, e só com os e-mails da
 *     ZapSign ligados nas configurações.
 *   * Cancelar — quem cancela, enquanto espera alguém. Assinado NUNCA.
 *   * Reenviar como novo pacote — quem envia, para recusado/expirado/
 *     cancelado que chegou a ser enviado, uma vez só (depois aponta o novo).
 */

export type PackagePermissions = {
  view: boolean;
  download: boolean;
  send: boolean;
  cancel: boolean;
};

export type PackageFacts = {
  status: PackageStatus;
  hasMergedPdf: boolean;
  hasSignedPdf: boolean;
  /** Já foi para a ZapSign (tem `sent_at`). */
  wasSent: boolean;
  /** Paciente: o reenvio como novo pacote refaz o envio ao paciente. */
  audience: "patient" | "company";
  zapsignEmailsEnabled: boolean;
  /** Número do pacote que já o substituiu, quando houver. */
  resentAs: string | null;
};

export type AllowedActions = {
  view: false | "merged" | "signed";
  downloadSigned: boolean;
  downloadCopy: boolean;
  resend: boolean;
  resendByZapsignEmail: boolean;
  cancel: boolean;
  /** Pacote assinado, para quem cancela: o botão aparece apagado com este porquê. */
  cancelBlockedReason: string | null;
  resendAsNew: boolean;
};

const WAITING: PackageStatus[] = ["sent", "partially_signed"];
const RESENDABLE_AS_NEW: PackageStatus[] = ["refused", "expired", "cancelled"];

export function acoesPermitidas(f: PackageFacts, p: PackagePermissions): AllowedActions {
  const waiting = WAITING.includes(f.status);

  let view: AllowedActions["view"] = false;
  if (p.view && f.status !== "draft") {
    if (f.status === "signed" && f.hasSignedPdf) view = "signed";
    else if (f.hasMergedPdf) view = "merged";
  }

  // Só o ASSINADO mostra o Cancelar apagado com o porquê: é a pergunta que
  // a equipe faz ("por que não consigo cancelar?"). Nos outros finais o botão
  // simplesmente não aparece.
  const cancelBlockedReason = p.cancel && f.status === "signed" ? "Documento assinado não pode ser cancelado." : null;

  return {
    view,
    downloadSigned: p.download && f.status === "signed" && f.hasSignedPdf,
    downloadCopy: p.download && f.status !== "draft" && f.wasSent && f.hasMergedPdf,
    resend: p.send && waiting,
    resendByZapsignEmail: p.send && waiting && f.zapsignEmailsEnabled,
    cancel: p.cancel && waiting,
    cancelBlockedReason,
    resendAsNew:
      p.send && f.audience === "patient" && RESENDABLE_AS_NEW.includes(f.status) && f.wasSent && !f.resentAs,
  };
}

/** Alguma ação aparece? (a tela some com a barra quando não há nenhuma) */
export function temAlgumaAcao(a: AllowedActions): boolean {
  return !!a.view || a.downloadSigned || a.downloadCopy || a.resend || a.cancel || a.resendAsNew;
}
