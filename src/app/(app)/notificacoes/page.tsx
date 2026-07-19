import type { Metadata } from "next";
import Link from "next/link";
import { Bell } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { FilterForm } from "@/components/filter-form";
import { cn } from "@/lib/utils";
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_DOT,
  categorizeNotification,
  type NotificationCategory,
} from "@/lib/notifications";
import { NotificationList } from "./notification-list";

export const metadata: Metadata = { title: "Notificações" };

export type NotificationRow = {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
  clinic_id: string | null;
  clinics: { name: string } | null;
};

type ClinicTag = { id: string; name: string };

export default async function NotificationsPage(
  props: PageProps<"/notificacoes">
) {
  const session = await getSessionContext();
  const searchParams = await props.searchParams;
  const supabase = await createClient();

  // Notifications are tagged with the UNIT where the client is. Franchisor
  // users (planner, consultant, assistant, SDR) receive notifications from
  // units, so defaulting to the active clinic would hide everything for them.
  // Default: active clinic only when it is a UNIT; otherwise show all.
  const activeIsUnit = session.activeClinic?.type === "franchise_unit";
  const requested =
    typeof searchParams.unidade === "string" ? searchParams.unidade : null;
  const scope =
    requested ?? (activeIsUnit ? session.activeClinic!.id : "todas");
  const categoria =
    typeof searchParams.categoria === "string" ? searchParams.categoria : "";

  // Build the unit filter from the clinics actually present in the user's
  // notifications (works for franchisor users who only "live" in the matriz).
  const { data: tagRows } = await supabase
    .from("notifications")
    .select("clinic_id, clinics ( name )")
    .eq("user_id", session.userId)
    .not("clinic_id", "is", null)
    .limit(500)
    .returns<{ clinic_id: string; clinics: { name: string } | null }[]>();

  const clinicTags: ClinicTag[] = [];
  const seen = new Set<string>();
  for (const row of tagRows ?? []) {
    if (row.clinic_id && !seen.has(row.clinic_id)) {
      seen.add(row.clinic_id);
      clinicTags.push({ id: row.clinic_id, name: row.clinics?.name ?? "—" });
    }
  }
  clinicTags.sort((a, b) => a.name.localeCompare(b.name));

  let query = supabase
    .from("notifications")
    .select(
      "id, title, body, link, read_at, created_at, clinic_id, clinics ( name )"
    )
    .eq("user_id", session.userId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (scope !== "todas") {
    query = query.eq("clinic_id", scope);
  }

  const { data: notificationRows } = await query.returns<NotificationRow[]>();
  const all = notificationRows ?? [];

  // Categorize at read time and count per category (within the unit scope).
  const counts: Record<NotificationCategory, number> = {
    plano: 0,
    comercial: 0,
    compartilhamento: 0,
    inicio_tratamento: 0,
    agenda: 0,
    aniversario: 0,
    transferencia: 0,
    outras: 0,
  };
  for (const n of all) counts[categorizeNotification(n.title)] += 1;

  const unreadCount = all.filter((n) => !n.read_at).length;
  const onlyUnread = searchParams.naolidas === "1";

  let notifications = categoria
    ? all.filter((n) => categorizeNotification(n.title) === categoria)
    : all;
  if (onlyUnread) notifications = notifications.filter((n) => !n.read_at);

  function chipHref(cat: string | null, unread = onlyUnread): string {
    const p = new URLSearchParams();
    if (cat) p.set("categoria", cat);
    if (requested) p.set("unidade", requested);
    if (unread) p.set("naolidas", "1");
    const qs = p.toString();
    return qs ? `/notificacoes?${qs}` : "/notificacoes";
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="relative flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Bell className="size-5" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 flex min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[10px] font-semibold text-gold-foreground tabular-nums">
                {unreadCount}
              </span>
            )}
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Notificações
            </h1>
            <p className="text-sm text-muted-foreground">
              {unreadCount > 0
                ? `${unreadCount} não ${unreadCount === 1 ? "lida" : "lidas"} · avisos da jornada dos clientes.`
                : "Tudo em dia — avisos da jornada dos clientes."}
            </p>
          </div>
        </div>
        {clinicTags.length > 1 && (
          <FilterForm className="flex items-center gap-2">
            {categoria && (
              <input type="hidden" name="categoria" value={categoria} />
            )}
            <select
              name="unidade"
              defaultValue={scope}
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
            >
              <option value="todas">Todas as unidades</option>
              {clinicTags.map((clinic) => (
                <option key={clinic.id} value={clinic.id}>
                  {clinic.name}
                </option>
              ))}
            </select>
          </FilterForm>
        )}
      </div>

      {/* Categorias (clicáveis) com bolinha de cor + contadores. As sem itens
          ficam escondidas para reduzir ruído. */}
      <div className="flex flex-wrap gap-2">
        <Link
          href={chipHref(null)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors hover:bg-muted/60",
            categoria === "" && "border-primary bg-primary/10 text-primary"
          )}
        >
          Todas{" "}
          <span className="tabular-nums text-muted-foreground">
            {all.length}
          </span>
        </Link>
        {unreadCount > 0 && (
          <Link
            href={chipHref(categoria || null, !onlyUnread)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors hover:bg-muted/60",
              onlyUnread && "border-gold bg-gold/10 text-gold-foreground"
            )}
          >
            <span className="size-2 rounded-full bg-gold" />
            Não lidas <span className="tabular-nums">{unreadCount}</span>
          </Link>
        )}
        {NOTIFICATION_CATEGORIES.filter((c) => counts[c.key] > 0).map((c) => (
          <Link
            key={c.key}
            href={chipHref(c.key)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors hover:bg-muted/60",
              categoria === c.key && "border-primary bg-primary/10 text-primary"
            )}
          >
            <span
              className={cn(
                "size-2 rounded-full",
                NOTIFICATION_CATEGORY_DOT[c.key]
              )}
            />
            {c.label}{" "}
            <span className="tabular-nums text-muted-foreground">
              {counts[c.key]}
            </span>
          </Link>
        ))}
      </div>

      <NotificationList notifications={notifications} />
    </div>
  );
}
