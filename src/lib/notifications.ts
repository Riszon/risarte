// Notification categories for the notification center (F6). Notifications are
// stored with a free-text title (written by the DB functions); we classify them
// at read time by the title. Keep this in sync with the titles used in the
// migrations (e.g. "Plano aprovado", "Cliente compartilhado...", "Fechamento!
// Agendar início de tratamento", "Cliente transferido para outra unidade").

export const NOTIFICATION_CATEGORIES = [
  { key: "plano", label: "Plano de Tratamento" },
  { key: "compartilhamento", label: "Compartilhamento" },
  { key: "inicio_tratamento", label: "Início de Tratamento" },
  { key: "agenda", label: "Agenda" },
  { key: "transferencia", label: "Transferência" },
  { key: "outras", label: "Outras" },
] as const;

export type NotificationCategory =
  (typeof NOTIFICATION_CATEGORIES)[number]["key"];

export const NOTIFICATION_CATEGORY_LABELS = Object.fromEntries(
  NOTIFICATION_CATEGORIES.map((c) => [c.key, c.label])
) as Record<NotificationCategory, string>;

/** Color classes for a category chip/badge. */
export const NOTIFICATION_CATEGORY_CLASS: Record<NotificationCategory, string> = {
  plano: "bg-primary/10 text-primary",
  compartilhamento: "bg-emerald-100 text-emerald-800",
  inicio_tratamento: "bg-gold text-gold-foreground",
  agenda: "bg-red-100 text-red-800",
  transferencia: "bg-amber-100 text-amber-800",
  outras: "bg-muted text-muted-foreground",
};

export function categorizeNotification(title: string): NotificationCategory {
  const t = (title ?? "").toLowerCase();
  if (t.startsWith("plano")) return "plano";
  if (t.includes("compartilh")) return "compartilhamento";
  // Agenda closures contain "fechamento" too — classify before the journey
  // "Fechamento!" (início de tratamento) check below.
  if (t.includes("fechamento de agenda") || t.includes("remarcar")) {
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
