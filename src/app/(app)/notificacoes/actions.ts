"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: boolean; error?: string };

export async function markNotificationRead(
  notificationId: string
): Promise<ActionResult> {
  const session = await getSessionContext();
  const supabase = await createClient();

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("user_id", session.userId)
    .is("read_at", null);

  if (error) {
    console.error("markNotificationRead failed:", error.message);
    return { ok: false, error: "Não foi possível marcar como lida." };
  }
  revalidatePath("/notificacoes");
  return { ok: true };
}

export async function markAllNotificationsRead(): Promise<ActionResult> {
  const session = await getSessionContext();
  const supabase = await createClient();

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", session.userId)
    .is("read_at", null);

  if (error) {
    console.error("markAllNotificationsRead failed:", error.message);
    return { ok: false, error: "Não foi possível marcar como lidas." };
  }
  revalidatePath("/notificacoes");
  return { ok: true };
}
