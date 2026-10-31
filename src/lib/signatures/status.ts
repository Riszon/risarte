import type { PackageStage, PackageStatus, SignerStatus } from "./types";

/**
 * Os nomes e tons de cada situação (plano ZS0 §10). Uma leitura só, para a
 * lista, o detalhe, a aba Documentos e os painéis dizerem a mesma coisa.
 */

export const PACKAGE_STATUS_LABEL: Record<PackageStatus, string> = {
  draft: "Rascunho",
  sent: "Enviado",
  partially_signed: "Parcialmente assinado",
  signed: "Assinado",
  refused: "Recusado",
  expired: "Expirado",
  cancelled: "Cancelado",
};

/** Classes Tailwind do selo (claro e escuro), no padrão de `src/lib/tons.ts`. */
export const PACKAGE_STATUS_CLASS: Record<PackageStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  sent: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  partially_signed: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  signed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  refused: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  expired: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200",
  cancelled: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
};

export const STAGE_LABEL: Record<PackageStage, string> = {
  client: "aguardando o cliente",
  witnesses: "aguardando as testemunhas",
  risarte: "aguardando a Risarte",
  done: "concluído",
};

export const SIGNER_STATUS_LABEL: Record<SignerStatus, string> = {
  pending: "Pendente",
  link_opened: "Abriu o link",
  signed: "Assinou",
  refused: "Recusou",
};

/** Situações em que o pacote ainda espera alguém. */
export function isWaiting(status: PackageStatus): boolean {
  return status === "sent" || status === "partially_signed";
}

/** Situações finais: nada mais acontece com o pacote. */
export function isFinal(status: PackageStatus): boolean {
  return status === "signed" || status === "refused" || status === "expired" || status === "cancelled";
}
