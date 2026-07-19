// Notification categories for the notification center (F6). Notifications are
// stored with a free-text title (written by the DB functions); we classify them
// at read time by the title. Keep this in sync with the titles used in the
// migrations (e.g. "Plano aprovado", "Cliente compartilhado...", "Fechamento!
// Agendar início de tratamento", "Cliente transferido para outra unidade").

export const NOTIFICATION_CATEGORIES = [
  { key: "plano", label: "Plano de Tratamento" },
  { key: "comercial", label: "Comercial" },
  { key: "compartilhamento", label: "Compartilhamento" },
  { key: "inicio_tratamento", label: "Início de Tratamento" },
  { key: "agenda", label: "Agenda" },
  { key: "aniversario", label: "Aniversários" },
  { key: "transferencia", label: "Transferência" },
  { key: "outras", label: "Outras" },
] as const;

export type NotificationCategory =
  (typeof NOTIFICATION_CATEGORIES)[number]["key"];

export const NOTIFICATION_CATEGORY_LABELS = Object.fromEntries(
  NOTIFICATION_CATEGORIES.map((c) => [c.key, c.label])
) as Record<NotificationCategory, string>;

/** Color classes for a category chip/badge (tinted bg + readable text). */
export const NOTIFICATION_CATEGORY_CLASS: Record<NotificationCategory, string> = {
  plano: "bg-primary/10 text-primary",
  comercial: "bg-violet-100 text-violet-800",
  compartilhamento: "bg-emerald-100 text-emerald-800",
  inicio_tratamento: "bg-gold text-gold-foreground",
  agenda: "bg-red-100 text-red-800",
  aniversario: "bg-pink-100 text-pink-800",
  transferencia: "bg-amber-100 text-amber-800",
  outras: "bg-muted text-muted-foreground",
};

/** Solid dot color for a category (used in the filter chips). */
export const NOTIFICATION_CATEGORY_DOT: Record<NotificationCategory, string> = {
  plano: "bg-primary",
  comercial: "bg-violet-500",
  compartilhamento: "bg-emerald-500",
  inicio_tratamento: "bg-gold",
  agenda: "bg-red-500",
  aniversario: "bg-pink-500",
  transferencia: "bg-amber-500",
  outras: "bg-muted-foreground",
};

export function categorizeNotification(title: string): NotificationCategory {
  const t = (title ?? "").toLowerCase();
  if (t.includes("aniversari")) return "aniversario";
  if (t.startsWith("plano")) return "plano";
  // Conversão Comercial (H3.15): "apresentação comercial" pronta / sem agenda.
  if (t.includes("apresenta") || t.includes("comercial")) return "comercial";
  if (t.includes("compartilh")) return "compartilhamento";
  // Agenda closures contain "fechamento" too — classify before the journey
  // "Fechamento!" (início de tratamento) check below. "fora do horário" = aviso
  // de atendimento que extrapola o expediente (AJ2).
  if (
    t.includes("fechamento de agenda") ||
    t.includes("remarcar") ||
    t.includes("fora do horário")
  ) {
    return "agenda";
  }
  if (
    t.includes("fechamento") ||
    t.includes("início de tratamento") ||
    t.includes("iniciar tratamento")
  ) {
    return "inicio_tratamento";
  }
  if (t.includes("transferid") || t.includes("transfer")) return "transferencia";
  return "outras";
}
