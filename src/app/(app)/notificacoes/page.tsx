import type { Metadata } from "next";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { NotificationList } from "./notification-list";

export const metadata: Metadata = { title: "Notificações" };

export type NotificationRow = {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
  clinics: { name: string } | null;
};

export default async function NotificationsPage() {
  const session = await getSessionContext();
  const supabase = await createClient();

  const { data: notifications } = await supabase
    .from("notifications")
    .select("id, title, body, link, read_at, created_at, clinics ( name )")
    .eq("user_id", session.userId)
    .order("created_at", { ascending: false })
    .limit(100)
    .returns<NotificationRow[]>();

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Notificações</h1>
        <p className="text-sm text-muted-foreground">
          Avisos automáticos da jornada dos clientes.
        </p>
      </div>
      <NotificationList notifications={notifications ?? []} />
    </div>
  );
}
