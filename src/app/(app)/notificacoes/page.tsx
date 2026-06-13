import type { Metadata } from "next";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
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

export default async function NotificationsPage(
  props: PageProps<"/notificacoes">
) {
  const session = await getSessionContext();
  const searchParams = await props.searchParams;
  const supabase = await createClient();

  // Default scope = active clinic; "todas" shows every clinic the user belongs to.
  const requested =
    typeof searchParams.unidade === "string" ? searchParams.unidade : null;
  const scope =
    requested ?? session.activeClinic?.id ?? "todas";

  let query = supabase
    .from("notifications")
    .select(
      "id, title, body, link, read_at, created_at, clinic_id, clinics ( name )"
    )
    .eq("user_id", session.userId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (scope !== "todas") {
    query = query.eq("clinic_id", scope);
  }

  const { data: notifications } = await query.returns<NotificationRow[]>();

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
        {session.clinics.length > 1 && (
          <form method="get" className="flex items-center gap-2">
            <select
              name="unidade"
              defaultValue={scope}
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
            >
              <option value="todas">Todas as unidades</option>
              {session.clinics.map((clinic) => (
                <option key={clinic.id} value={clinic.id}>
                  {clinic.name}
                </option>
              ))}
            </select>
            <Button type="submit" variant="outline" size="sm">
              Filtrar
            </Button>
          </form>
        )}
      </div>
      <NotificationList notifications={notifications ?? []} />
    </div>
  );
}
