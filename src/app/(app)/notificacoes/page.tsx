import type { Metadata } from "next";
import Link from "next/link";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { FilterForm } from "@/components/filter-form";
import {
  NOTIFICATION_CATEGORIES,
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
    compartilhamento: 0,
    inicio_tratamento: 0,
    transferencia: 0,
    outras: 0,
  };
  for (const n of all) counts[categorizeNotification(n.title)] += 1;

  const notifications = categoria
    ? all.filter((n) => categorizeNotification(n.title) === categoria)
    : all;

  function chipHref(cat: string | null): string {
    const p = new URLSearchParams();
    if (cat) p.set("categoria", cat);
    if (requested) p.set("unidade", requested);
    const qs = p.toString();
    return qs ? `/notificacoes?${qs}` : "/notificacoes";
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Notificações
          </h1>
          <p className="text-sm text-muted-foreground">
            Avisos automáticos da jornada dos clientes.
          </p>
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

      {/* Categorias (clicáveis) com contadores. */}
      <div className="flex flex-wrap gap-2">
        <Link
          href={chipHref(null)}
          className={`rounded-full border px-3 py-1 text-sm ${
            categoria === "" ? "border-primary bg-primary/10 text-primary" : ""
          }`}
        >
          Todas ({all.length})
        </Link>
        {NOTIFICATION_CATEGORIES.map((c) => (
          <Link
            key={c.key}
            href={chipHref(c.key)}
            className={`rounded-full border px-3 py-1 text-sm ${
              categoria === c.key
                ? "border-primary bg-primary/10 text-primary"
                : ""
            }`}
          >
            {c.label} ({counts[c.key]})
          </Link>
        ))}
      </div>

      <NotificationList notifications={notifications} />
    </div>
  );
}
